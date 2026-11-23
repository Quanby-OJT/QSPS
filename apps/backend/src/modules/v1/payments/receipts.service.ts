import { Injectable, NotFoundException } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { asc, eq } from "drizzle-orm"

import type { ReceiptVerification } from "@repo/contracts"
import {
	bookingItems,
	bookings,
	paymentChannels,
	payments,
	receipts,
	services,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { PdfService } from "@/common/pdf/pdf.service"
import { env } from "@/config/env.config"

import { drawReceipt } from "./receipt-pdf"

const AUDIT_DOMAIN_PAYMENTS = "payments"

/**
 * Same rule as `ReceiptTokenSchema` in @repo/contracts. Kept here because
 * backend Jest cannot load that package's runtime exports (see manila-time.ts).
 */
const RECEIPT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/

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
	 */
	async renderForOwner(paymentId: number, actorId: string | null): Promise<RenderedReceipt> {
		const [row] = await db
			.select({
				receiptId: receipts.id,
				receiptNumber: receipts.receiptNumber,
				verificationToken: receipts.verificationToken,
				issuedAt: receipts.issuedAt,
				amountCentavos: payments.amountCentavos,
				convenienceFeeCentavos: payments.convenienceFeeCentavos,
				channelCode: payments.channelCode,
				channelName: paymentChannels.name,
				paymentStatus: payments.status,
				bookingId: bookings.id,
				referenceNumber: bookings.referenceNumber,
				clientId: bookings.clientId,
				clientName: users.name,
			})
			.from(receipts)
			.innerJoin(payments, eq(payments.id, receipts.paymentId))
			.innerJoin(bookings, eq(bookings.id, payments.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.leftJoin(paymentChannels, eq(paymentChannels.code, payments.channelCode))
			.where(eq(receipts.paymentId, paymentId))
			.limit(1)

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

		const items = await db
			.select({ serviceName: services.name, feeCentavos: bookingItems.feeCentavos })
			.from(bookingItems)
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.where(eq(bookingItems.bookingId, row.bookingId))
			.orderBy(asc(bookingItems.id))

		const verifyUrl = receiptVerifyUrl(row.verificationToken)
		const qrPng = await this.pdfService.qrPng(verifyUrl)
		const pdf = await this.pdfService.render({ title: `e-Receipt ${row.receiptNumber}` }, doc =>
			drawReceipt(doc, {
				receiptNumber: row.receiptNumber,
				referenceNumber: row.referenceNumber,
				issuedAt: row.issuedAt,
				clientName: row.clientName,
				// Payments made before PAY-5 have a channel code with no row; print the code.
				channelName: row.channelName ?? row.channelCode,
				items,
				convenienceFeeCentavos: row.convenienceFeeCentavos,
				totalCentavos: row.amountCentavos,
				status: statusOf(row.paymentStatus),
				verifyUrl,
				qrPng,
			})
		)

		return { fileName: `${row.receiptNumber}.pdf`, pdf }
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
