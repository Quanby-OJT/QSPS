import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, desc, eq, ilike, inArray, type SQL, sql } from "drizzle-orm"

import type {
	CashierBooking,
	CashierSearchResult,
	CollectOnsiteInput,
	CollectOnsiteResult,
} from "@repo/contracts"
import {
	bookingItems,
	bookings,
	locations,
	payments,
	receipts,
	scheduleSlots,
	services,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { denyOutsideScope } from "@/common/scope/scope-denial"
import { inScope, NATIONWIDE_SCOPE, type ResolvedScope } from "@/common/scope/scope-match"

import { PaymentService } from "./payments.service"
import { type ReceiptLayout, ReceiptService, type RenderedReceipt } from "./receipts.service"

/**
 * Same rule as `REFERENCE_NUMBER_PATTERN` in @repo/contracts. Kept here
 * because backend Jest cannot load that package's runtime exports.
 */
const REFERENCE_NUMBER_PATTERN = /^QSPS-\d{6}-[A-Z0-9]{6}$/

/** How many bookings one search returns. */
const SEARCH_LIMIT = 20

/** `%` and `_` typed by the cashier match themselves, not "anything". */
function likePattern(text: string): string {
	return `%${text.replace(/[\\%_]/g, character => `\\${character}`)}%`
}

function requireActor(actorId: string | null): string {
	if (!actorId) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to use the cashier" })
	return actorId
}

type BookingRow = {
	id: number
	referenceNumber: string
	status: CashierBooking["status"]
	totalCentavos: number
	clientName: string
	clientEmail: string
}

type ItemRow = CashierBooking["items"][number] & {
	bookingId: number
	serviceCategoryId: number
	locationId: number
}

/**
 * The cashier screen (PAY-4, TOR §VIII.1): find a client's booking and record
 * their payment. Read-only apart from `collect`, which hands over to
 * `PaymentService.collectOnsite`: nothing here edits client data or
 * schedules (Annex A).
 *
 * Scope (ADM-2): a booking is visible when at least one of its Services is in
 * the cashier's Scope (Service Category and Location), which is where the
 * client is standing. Asking for one outside it answers the same 404 as a
 * missing booking, and the denial is audited.
 */
@Injectable()
export class CashierService {
	constructor(
		private readonly auditService: AuditService,
		private readonly paymentService: PaymentService,
		private readonly receiptService: ReceiptService
	) {}

	/**
	 * By Reference Number (typed, or scanned from the booking QR), client email,
	 * or part of the client's name. Unpaid bookings first.
	 */
	async search(
		query: string,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<CashierSearchResult> {
		const cashierId = requireActor(actorId)
		const text = query.trim()
		const reference = text.toUpperCase()

		if (REFERENCE_NUMBER_PATTERN.test(reference)) {
			const [booking] = await this.bookingRows(eq(bookings.referenceNumber, reference))
			if (!booking) return { bookings: [] }
			const items = await this.itemRows([booking.id])
			if (!this.visible(items, scope)) {
				await denyOutsideScope(this.auditService, cashierId, {
					type: "booking",
					id: booking.id,
					notFoundMessage: `No booking ${reference} at your location`,
				})
			}
			return { bookings: [await this.toCashierBooking(booking, items)] }
		}

		const condition = text.includes("@")
			? ilike(users.email, likePattern(text))
			: ilike(users.name, likePattern(text))
		// Read a few more than shown: some may be outside Scope.
		const rows = await this.bookingRows(condition, SEARCH_LIMIT * 3)
		const items = await this.itemRows(rows.map(row => row.id))
		const visible = rows
			.filter(row => this.visible(items.filter(item => item.bookingId === row.id), scope))
			.slice(0, SEARCH_LIMIT)

		return {
			bookings: await Promise.all(
				visible.map(row =>
					this.toCashierBooking(
						row,
						items.filter(item => item.bookingId === row.id)
					)
				)
			),
		}
	}

	/** One booking with its fee breakdown, inside Scope. */
	async get(
		bookingId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<CashierBooking> {
		const cashierId = requireActor(actorId)
		const { booking, items } = await this.requireInScope(bookingId, cashierId, scope)
		return this.toCashierBooking(booking, items)
	}

	/** Record the payment (PaymentService.collectOnsite), inside Scope. */
	async collect(
		input: CollectOnsiteInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<CollectOnsiteResult> {
		const cashierId = requireActor(actorId)
		await this.requireInScope(input.bookingId, cashierId, scope)
		return this.paymentService.collectOnsite(input, cashierId, now)
	}

	/**
	 * Print or reprint a receipt for a booking in Scope: A4, or the narrow
	 * passbook-printer layout.
	 */
	async receipt(
		paymentId: number,
		layout: ReceiptLayout,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<RenderedReceipt> {
		const cashierId = requireActor(actorId)
		const [payment] = await db
			.select({ bookingId: payments.bookingId })
			.from(payments)
			.where(eq(payments.id, paymentId))
			.limit(1)
		if (!payment) {
			throw new ORPCError("NOT_FOUND", { message: "Receipt not found" })
		}
		await this.requireInScope(payment.bookingId, cashierId, scope, "Receipt not found")
		return this.receiptService.renderForStaff(paymentId, layout)
	}

	private async requireInScope(
		bookingId: number,
		cashierId: string,
		scope: ResolvedScope,
		notFoundMessage = "Booking not found"
	): Promise<{ booking: BookingRow; items: ItemRow[] }> {
		const [booking] = await this.bookingRows(eq(bookings.id, bookingId))
		if (!booking) {
			throw new ORPCError("NOT_FOUND", { message: notFoundMessage })
		}
		const items = await this.itemRows([booking.id])
		if (!this.visible(items, scope)) {
			await denyOutsideScope(this.auditService, cashierId, {
				type: "booking",
				id: booking.id,
				notFoundMessage,
			})
		}
		return { booking, items }
	}

	private visible(items: ItemRow[], scope: ResolvedScope): boolean {
		return items.some(item =>
			inScope(scope, { serviceCategoryId: item.serviceCategoryId, locationId: item.locationId })
		)
	}

	private bookingRows(condition: SQL, limit = 1): Promise<BookingRow[]> {
		return db
			.select({
				id: bookings.id,
				referenceNumber: bookings.referenceNumber,
				status: bookings.status,
				totalCentavos: bookings.totalCentavos,
				clientName: users.name,
				clientEmail: users.email,
			})
			.from(bookings)
			.innerJoin(users, eq(users.id, bookings.clientId))
			.where(condition)
			.orderBy(
				// Unpaid first: that is what the cashier is there to collect.
				sql`case when ${bookings.status} = 'pending_payment' then 0 else 1 end`,
				desc(bookings.createdAt)
			)
			.limit(limit)
	}

	private async itemRows(bookingIds: number[]): Promise<ItemRow[]> {
		if (bookingIds.length === 0) return []
		return db
			.select({
				bookingId: bookingItems.bookingId,
				serviceName: services.name,
				locationName: locations.name,
				startsAt: scheduleSlots.startsAt,
				endsAt: scheduleSlots.endsAt,
				feeCentavos: bookingItems.feeCentavos,
				serviceCategoryId: services.serviceCategoryId,
				locationId: bookingItems.locationId,
			})
			.from(bookingItems)
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.innerJoin(scheduleSlots, eq(scheduleSlots.id, bookingItems.scheduleSlotId))
			.where(inArray(bookingItems.bookingId, bookingIds))
			.orderBy(asc(bookingItems.id))
	}

	private async toCashierBooking(booking: BookingRow, items: ItemRow[]): Promise<CashierBooking> {
		const [paid] = await db
			.select({ paymentId: payments.id, receiptNumber: receipts.receiptNumber })
			.from(payments)
			.leftJoin(receipts, eq(receipts.paymentId, payments.id))
			.where(and(eq(payments.bookingId, booking.id), eq(payments.status, "succeeded")))
			.orderBy(asc(payments.id))
			.limit(1)

		return {
			bookingId: booking.id,
			referenceNumber: booking.referenceNumber,
			status: booking.status,
			clientName: booking.clientName,
			clientEmail: booking.clientEmail,
			items: items.map(item => ({
				serviceName: item.serviceName,
				locationName: item.locationName,
				startsAt: item.startsAt,
				endsAt: item.endsAt,
				feeCentavos: item.feeCentavos,
			})),
			totalCentavos: booking.totalCentavos,
			paidPayment: paid ? { paymentId: paid.paymentId, receiptNumber: paid.receiptNumber } : null,
		}
	}
}
