import { Injectable, NotFoundException } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import type { ReceiptVerification } from "@repo/contracts"
import { bookings, payments, receipts } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { PdfService } from "@/common/pdf/pdf.service"
import { env } from "@/config/env.config"

import { drawPassbookReceipt, drawReceipt, PASSBOOK_PAGE } from "./receipt-pdf"

const AUDIT_DOMAIN_PAYMENTS = "payments"

/**
 * Same rule as `ReceiptTokenSchema` in @repo/contracts. Kept here because
 * backend Jest cannot load that package's runtime exports (see manila-time.ts).
 */
const RECEIPT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

/** A receipt with its Payment and Booking, as `ReceiptService` reads it. */
interface ReceiptRow {
	receiptId: number
	receiptNumber: string
	verificationToken: string
	issuedAt: Date
	clientName: string
	channelName: string
	serviceLines: { serviceName: string; feeCentavos: number }[]
	amountCentavos: number
	convenienceFeeCentavos: number
	paymentStatus: string
	referenceNumber: string
	clientId: string
}

/** A4 for the office printer, or the narrow passbook-printer layout (PAY-4). */
export type ReceiptLayout = "a4" | "passbook"

export interface RenderedReceipt {
	fileName: string
	pdf: Buffer
}

/** The public page a receipt's QR code points to. */
export function receiptVerifyUrl(token: string): string {
	return `${env.APP_WEB_URL}/receipts/verify/${token}`
}

function statusOf(paymentStatus: string): "valid" | "refunded" {
	return paymentStatus === "refunded" ? "refunded" : "valid"
}

/**
 * e-Receipts (PAY-2). Receipts are created by `PaymentService.confirm`; this
 * service only reads them: the PDF for the owner, and the public
 * verification lookup. The PDF is rendered from the database on every
 * request and never stored.
 */
@Injectable()
export class ReceiptService {
	constructor(
		private readonly auditService: AuditService,
		private readonly pdfService: PdfService
	) {}

	/**
	 * The receipt PDF for a Payment, for the client who owns its Booking.
	 * Anyone else, and a Payment with no receipt, gets the same 404.
	 *
	 * PAY-2a: the client, channel and Service names are the ones stored on the
	 * receipt when it was issued, never today's, so a rename does not change
	 * a reprint. The total and convenience fee come from the Payment.
	 */
	async renderForOwner(paymentId: number, actorId: string | null): Promise<RenderedReceipt> {
		const row = await this.load(paymentId)

		if (!row || !actorId || row.clientId !== actorId) {
			if (actorId) {
				await this.auditService.record({
					domain: AUDIT_DOMAIN_PAYMENTS,
					action: "receipt.read",
					outcome: "denied",
					actorId,
					targetType: "payment",
					targetId: String(paymentId),
					reason: row ? "not_owner" : "not_found",
				})
			}
			throw new NotFoundException("Receipt not found")
		}

		return this.render(row, "a4")
	}

	/**
	 * The receipt PDF for staff at the cashier (PAY-4), to print or reprint.
	 * The caller has already checked the permission and Scope (CashierService).
	 */
	async renderForStaff(paymentId: number, layout: ReceiptLayout): Promise<RenderedReceipt> {
		const row = await this.load(paymentId)
		if (!row) {
			throw new ORPCError("NOT_FOUND", { message: "Receipt not found" })
		}
		return this.render(row, layout)
	}

	private async load(paymentId: number): Promise<ReceiptRow | undefined> {
		const [row] = await db
			.select({
				receiptId: receipts.id,
				receiptNumber: receipts.receiptNumber,
				verificationToken: receipts.verificationToken,
				issuedAt: receipts.issuedAt,
				clientName: receipts.clientName,
				channelName: receipts.channelName,
				serviceLines: receipts.serviceLines,
				amountCentavos: payments.amountCentavos,
				convenienceFeeCentavos: payments.convenienceFeeCentavos,
				paymentStatus: payments.status,
				referenceNumber: bookings.referenceNumber,
				clientId: bookings.clientId,
			})
			.from(receipts)
			.innerJoin(payments, eq(payments.id, receipts.paymentId))
			.innerJoin(bookings, eq(bookings.id, payments.bookingId))
			.where(eq(receipts.paymentId, paymentId))
			.limit(1)
		return row
	}

	private async render(
		row: ReceiptRow,
		layout: ReceiptLayout
	): Promise<RenderedReceipt> {
		const verifyUrl = receiptVerifyUrl(row.verificationToken)
		const qrPng = await this.pdfService.qrPng(verifyUrl)
		const data = {
			receiptNumber: row.receiptNumber,
			referenceNumber: row.referenceNumber,
			issuedAt: row.issuedAt,
			clientName: row.clientName,
			channelName: row.channelName,
			items: row.serviceLines,
			convenienceFeeCentavos: row.convenienceFeeCentavos,
			totalCentavos: row.amountCentavos,
			status: statusOf(row.paymentStatus),
			verifyUrl,
			qrPng,
		}
		const title = `e-Receipt ${row.receiptNumber}`
		const pdf =
			layout === "passbook"
				? await this.pdfService.render({ title, size: PASSBOOK_PAGE, margin: 18 }, doc =>
						drawPassbookReceipt(doc, data)
					)
				: await this.pdfService.render({ title }, doc => drawReceipt(doc, data))

		const suffix = layout === "passbook" ? "-passbook" : ""
		return { fileName: `${row.receiptNumber}${suffix}.pdf`, pdf }
	}

	/**
	 * Public lookup behind the QR code. Returns only the receipt number,
	 * amount, issue date and status; an unknown or malformed token is a 404
	 * that says nothing else.
	 *
	 * Runs inside an oRPC handler, so it throws ORPCError: oRPC turns any
	 * other error (including Nest's NotFoundException) into a 500.
	 */
	async verify(token: string): Promise<ReceiptVerification> {
		if (!RECEIPT_TOKEN_PATTERN.test(token)) {
			throw new ORPCError("NOT_FOUND", { message: "No receipt found" })
		}

		const [row] = await db
			.select({
				receiptNumber: receipts.receiptNumber,
				issuedAt: receipts.issuedAt,
				amountCentavos: payments.amountCentavos,
				paymentStatus: payments.status,
			})
			.from(receipts)
			.innerJoin(payments, eq(payments.id, receipts.paymentId))
			.where(eq(receipts.verificationToken, token))
			.limit(1)

		if (!row) {
			throw new ORPCError("NOT_FOUND", { message: "No receipt found" })
		}

		return {
			receiptNumber: row.receiptNumber,
			amountCentavos: row.amountCentavos,
			issuedAt: row.issuedAt,
			status: statusOf(row.paymentStatus),
		}
	}
}
