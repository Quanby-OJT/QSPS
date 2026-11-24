import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import type {
	PaymentException,
	PaymentExceptionList,
	ResolvePaymentReviewInput,
	ResolvePaymentReviewResult,
} from "@repo/contracts"
import { bookingItems, bookings, payments, receipts, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { denyOutsideScope } from "@/common/scope/scope-denial"
import { NATIONWIDE_SCOPE, type ResolvedScope } from "@/common/scope/scope-match"

import { visibleToCashier } from "./cashier-scope"
import { PaymentService } from "./payments.service"

/** The most exceptions one list shows; staff resolve them from the top. */
const LIST_LIMIT = 200

/**
 * Payment exceptions in the admin portal (PAY-6): succeeded Payments flagged
 * `needs_review` that staff have not resolved yet. A late payment on a
 * cancelled Booking, or a second payment on a paid one.
 *
 * Scope (ADM-2): payments staff work by Location, like the cashier (PAY-4),
 * so an exception is visible when one of its Booking's items is at a
 * Location the caller's Scope covers. Resolving one outside it answers 404
 * and the denial is audited.
 */
@Injectable()
export class PaymentExceptionsService {
	constructor(
		private readonly auditService: AuditService,
		private readonly paymentService: PaymentService
	) {}

	async list(scope: ResolvedScope = NATIONWIDE_SCOPE): Promise<PaymentExceptionList> {
		const rows = await db
			.select({
				paymentId: payments.id,
				bookingId: payments.bookingId,
				referenceNumber: bookings.referenceNumber,
				bookingStatus: bookings.status,
				clientName: users.name,
				clientEmail: users.email,
				amountCentavos: payments.amountCentavos,
				channelCode: payments.channelCode,
				providerCode: payments.providerCode,
				paidAt: payments.updatedAt,
				receiptNumber: receipts.receiptNumber,
			})
			.from(payments)
			.innerJoin(bookings, eq(bookings.id, payments.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.leftJoin(receipts, eq(receipts.paymentId, payments.id))
			.where(
				and(
					eq(payments.status, "succeeded"),
					eq(payments.needsReview, true),
					isNull(payments.reviewResolution)
				)
			)
			.orderBy(desc(payments.updatedAt), desc(payments.id))
			.limit(LIST_LIMIT)
		if (rows.length === 0) return { exceptions: [] }

		const bookingIds = [...new Set(rows.map(row => row.bookingId))]
		const items = await db
			.select({ bookingId: bookingItems.bookingId, locationId: bookingItems.locationId })
			.from(bookingItems)
			.where(inArray(bookingItems.bookingId, bookingIds))
		// A Booking another, unflagged Payment paid makes this one a duplicate.
		const paidBy = await db
			.select({ bookingId: payments.bookingId, id: payments.id })
			.from(payments)
			.where(
				and(
					inArray(payments.bookingId, bookingIds),
					eq(payments.status, "succeeded"),
					eq(payments.needsReview, false)
				)
			)

		const exceptions: PaymentException[] = rows
			.filter(row =>
				visibleToCashier(
					items.filter(item => item.bookingId === row.bookingId),
					scope
				)
			)
			.map(row => ({
				...row,
				reason: paidBy.some(paid => paid.bookingId === row.bookingId && paid.id !== row.paymentId)
					? "duplicate"
					: "late_payment",
			}))
		return { exceptions }
	}

	async resolve(
		input: ResolvePaymentReviewInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<ResolvePaymentReviewResult> {
		if (!actorId) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to resolve exceptions" })

		const [payment] = await db
			.select({ bookingId: payments.bookingId })
			.from(payments)
			.where(eq(payments.id, input.paymentId))
			.limit(1)
		if (!payment) {
			throw new ORPCError("NOT_FOUND", { message: "Payment not found" })
		}
		const items = await db
			.select({ locationId: bookingItems.locationId })
			.from(bookingItems)
			.where(eq(bookingItems.bookingId, payment.bookingId))
		if (!visibleToCashier(items, scope)) {
			await denyOutsideScope(this.auditService, actorId, {
				type: "payment",
				id: input.paymentId,
				notFoundMessage: "Payment not found",
			})
		}
		return this.paymentService.resolveReview(input, actorId, now)
	}
}
