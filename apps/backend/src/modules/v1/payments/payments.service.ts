import { Injectable, Logger } from "@nestjs/common"
import { createHash } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, eq } from "drizzle-orm"

import type {
	CreatePaymentInput,
	PaymentCheckout,
	PaymentStatus,
	PaymentStatusResponse,
} from "@repo/contracts"
import { bookings, paymentEvents, payments, receipts } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import { env } from "@/config/env.config"

import { BookingService } from "../bookings/bookings.service"
import { canTransitionPayment } from "./payment-state"
import type { ParsedNotification, RawNotification } from "./providers/payment-provider"
import { PaymentProviderRegistry } from "./providers/provider-registry"
import { newVerificationToken, receiptNumberFor } from "./receipt-number"

const AUDIT_DOMAIN_PAYMENTS = "payments"

/** What happened to one provider notification. */
export type NotificationOutcome =
	| "processed"
	| "duplicate"
	| "ignored"
	| "invalid_signature"
	| "unknown_provider"

export interface ConfirmResult {
	/** True when an earlier notification already confirmed this payment. */
	alreadyConfirmed: boolean
	/** True when money arrived for a Booking that can no longer be paid. */
	needsReview: boolean
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Payments (PAY-1). The only code that writes `payments` and
 * `payment_events` (DOMAIN-MODEL.md section 6), and, through
 * `BookingService.markPaid`, the only way a Booking becomes `paid`.
 *
 * Flow C in TICKETS.md: create (initiated) → checkout (pending) → signed
 * provider notification → confirm (succeeded, booking paid). The browser's
 * return from checkout never changes anything.
 */
@Injectable()
export class PaymentService {
	private readonly logger = new Logger(PaymentService.name)

	constructor(
		private readonly auditService: AuditService,
		private readonly bookingService: BookingService,
		private readonly providers: PaymentProviderRegistry
	) {}

	/**
	 * Start paying a Booking (Flow C steps 1 and 2).
	 *
	 * The Payment row is committed before the provider is called, so a
	 * notification that arrives very fast always finds it. The amount is the
	 * Booking total plus the channel's convenience fee (zero until PAY-5).
	 */
	async create(
		input: CreatePaymentInput,
		actorId: string | null,
		now: Date = new Date()
	): Promise<PaymentCheckout> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to pay" })
		}

		const provider = this.providers.find(input.channelCode)
		if (!provider) {
			throw new ORPCError("BAD_REQUEST", { message: "This payment channel is not available" })
		}

		const [booking] = await db
			.select({
				id: bookings.id,
				clientId: bookings.clientId,
				status: bookings.status,
				referenceNumber: bookings.referenceNumber,
				totalCentavos: bookings.totalCentavos,
			})
			.from(bookings)
			.where(eq(bookings.id, input.bookingId))
			.limit(1)

		// Someone else's booking looks exactly like a missing one, so ids
		// cannot be probed. The attempt is still recorded.
		if (!booking || booking.clientId !== actorId) {
			await this.recordDenial(actorId, "payment.create", "booking", input.bookingId, booking)
			throw new ORPCError("NOT_FOUND", { message: "Booking not found" })
		}
		if (booking.status !== "pending_payment") {
			throw new ORPCError("CONFLICT", { message: "This booking is not awaiting payment" })
		}

		// PAY-5 replaces this with the channel's configured fee.
		const convenienceFeeCentavos = 0
		const amountCentavos = booking.totalCentavos + convenienceFeeCentavos

		const payment = await db.transaction(async tx => {
			// Re-read under a lock: the booking may have been cancelled or paid
			// between the read above and now.
			const [locked] = await tx
				.select({ status: bookings.status })
				.from(bookings)
				.where(eq(bookings.id, booking.id))
				.for("update")
			if (locked?.status !== "pending_payment") {
				throw new ORPCError("CONFLICT", { message: "This booking is not awaiting payment" })
			}

			const [row] = await tx
				.insert(payments)
				.values({
					bookingId: booking.id,
					channelCode: input.channelCode,
					providerCode: provider.code,
					amountCentavos,
					convenienceFeeCentavos,
					status: "initiated",
					createdAt: now,
					updatedAt: now,
				})
				.returning()
			if (!row) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Payment could not be created" })
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PAYMENTS,
					action: "payment.create",
					actorId,
					targetType: "payment",
					targetId: String(row.id),
					oldValue: null,
					newValue: {
						id: row.id,
						bookingId: row.bookingId,
						channelCode: row.channelCode,
						providerCode: row.providerCode,
						amountCentavos: row.amountCentavos,
						convenienceFeeCentavos: row.convenienceFeeCentavos,
						status: row.status,
					},
				},
				tx
			)
			return row
		})

		let session: { providerReference: string; checkoutUrl: string }
		try {
			session = await provider.createCheckout({
				paymentId: payment.id,
				referenceNumber: booking.referenceNumber,
				amountCentavos,
				description: `QSPS booking ${booking.referenceNumber}`,
				returnUrl: `${env.APP_WEB_URL}/payments/return?paymentId=${payment.id}`,
				notifyUrl: `${env.PAYMENT_NOTIFY_BASE_URL}/v1/payments/notifications/${provider.code}`,
			})
		} catch (error) {
			this.logger.error({
				event: "payments.checkout_failed",
				paymentId: payment.id,
				providerCode: provider.code,
				error: error instanceof Error ? error.message : String(error),
			})
			await this.moveTo(payment.id, "failed", actorId, now)
			throw new ORPCError("BAD_GATEWAY", {
				message: "The payment provider could not be reached. Please try again.",
			})
		}

		await db.transaction(async tx => {
			await tx
				.update(payments)
				.set({ providerReference: session.providerReference, status: "pending", updatedAt: now })
				.where(eq(payments.id, payment.id))
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PAYMENTS,
					action: "payment.checkout",
					actorId,
					targetType: "payment",
					targetId: String(payment.id),
					oldValue: { status: "initiated" },
					newValue: { status: "pending", providerReference: session.providerReference },
				},
				tx
			)
		})

		return {
			paymentId: payment.id,
			status: "pending",
			amountCentavos,
			convenienceFeeCentavos,
			checkoutUrl: session.checkoutUrl,
		}
	}

	/** A Payment's status for its owner. Read-only; the return page polls this. */
	async getStatus(paymentId: number, actorId: string | null): Promise<PaymentStatusResponse> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to view this payment" })
		}

		const [row] = await db
			.select({
				paymentId: payments.id,
				bookingId: payments.bookingId,
				status: payments.status,
				amountCentavos: payments.amountCentavos,
				clientId: bookings.clientId,
				referenceNumber: bookings.referenceNumber,
				bookingStatus: bookings.status,
				receiptNumber: receipts.receiptNumber,
			})
			.from(payments)
			.innerJoin(bookings, eq(bookings.id, payments.bookingId))
			.leftJoin(receipts, eq(receipts.paymentId, payments.id))
			.where(eq(payments.id, paymentId))
			.limit(1)

		if (!row || row.clientId !== actorId) {
			await this.recordDenial(actorId, "payment.read", "payment", paymentId, row)
			throw new ORPCError("NOT_FOUND", { message: "Payment not found" })
		}

		return {
			paymentId: row.paymentId,
			bookingId: row.bookingId,
			referenceNumber: row.referenceNumber,
			status: row.status,
			bookingStatus: row.bookingStatus,
			amountCentavos: row.amountCentavos,
			receiptNumber: row.receiptNumber ?? null,
		}
	}

	/**
	 * Handle one provider notification (Flow C steps 3 to 5).
	 *
	 * The event is stored before anything is checked. A forged, unreadable or
	 * wrong-amount notification is kept, changes nothing, and is logged as an
	 * alert. A redelivered one is recognised by its event id and skipped.
	 */
	async handleNotification(
		providerCode: string,
		notification: RawNotification,
		now: Date = new Date()
	): Promise<NotificationOutcome> {
		const provider = this.providers.find(providerCode)
		if (!provider) {
			this.logger.warn({ event: "payments.notification.unknown_provider", providerCode })
			return "unknown_provider"
		}

		let parsed: ParsedNotification
		try {
			parsed = provider.parseNotification(notification)
		} catch (error) {
			// The interface forbids throwing; treat a broken adapter as unverified.
			this.logger.error({
				event: "payments.notification.parse_failed",
				providerCode,
				error: error instanceof Error ? error.message : String(error),
			})
			parsed = {
				eventId: null,
				providerReference: null,
				status: null,
				amountCentavos: null,
				signatureValid: false,
				payload: notification.rawBody,
			}
		}

		// Only a verified event may claim the provider's event id. Otherwise a
		// forger who guessed an upcoming id could make the real notification
		// look like a duplicate. Unverified events dedupe on their body instead.
		const providerEventId =
			parsed.signatureValid && parsed.eventId
				? parsed.eventId
				: `unverified:${sha256(notification.rawBody)}`

		const payment = parsed.providerReference
			? await this.findByReference(provider.code, parsed.providerReference)
			: undefined

		const [event] = await db
			.insert(paymentEvents)
			.values({
				paymentId: payment?.id ?? null,
				providerCode: provider.code,
				providerEventId,
				// jsonb NOT NULL: fall back to the raw text if an adapter returned nothing.
				payload: parsed.payload ?? notification.rawBody,
				signatureValid: parsed.signatureValid,
				createdAt: now,
			})
			.onConflictDoNothing({ target: [paymentEvents.providerCode, paymentEvents.providerEventId] })
			.returning({ id: paymentEvents.id })

		if (!event) {
			this.logger.log({ event: "payments.notification.duplicate", providerCode, providerEventId })
			// A resent unverified notification is still refused. Answering 200 would
			// make a real gateway stop retrying while our secret is misconfigured,
			// and its payment would never be confirmed.
			return parsed.signatureValid ? "duplicate" : "invalid_signature"
		}

		if (!parsed.signatureValid) {
			this.alert("invalid_signature", { providerCode, paymentEventId: event.id })
			return "invalid_signature"
		}
		if (!payment) {
			this.alert("unknown_reference", { providerCode, paymentEventId: event.id })
			return "ignored"
		}

		if (parsed.status === "succeeded") {
			if (parsed.amountCentavos !== payment.amountCentavos) {
				this.alert("amount_mismatch", {
					providerCode,
					paymentEventId: event.id,
					paymentId: payment.id,
					expectedCentavos: payment.amountCentavos,
					reportedCentavos: parsed.amountCentavos,
				})
				return "ignored"
			}
			await this.confirm(payment.id, { actorId: null, paymentEventId: event.id }, now)
			return "processed"
		}

		if (parsed.status === "failed" || parsed.status === "expired") {
			await this.moveTo(payment.id, parsed.status, null, now, event.id)
			return "processed"
		}

		return "ignored"
	}

	/**
	 * Mark a Payment succeeded and its Booking paid, in one transaction (Flow C
	 * step 5). Safe to call more than once: a Payment that already succeeded is
	 * returned as it is. This is the only place a Booking becomes `paid`.
	 *
	 * Also used by the cashier flow (PAY-4) and the status re-query (PAY-6).
	 */
	async confirm(
		paymentId: number,
		options: { actorId: string | null; paymentEventId?: number },
		now: Date = new Date()
	): Promise<ConfirmResult> {
		return db.transaction(async tx => {
			const [payment] = await tx
				.select()
				.from(payments)
				.where(eq(payments.id, paymentId))
				.for("update")
			if (!payment) {
				throw new ORPCError("NOT_FOUND", { message: "Payment not found" })
			}

			const markEventProcessed = async () => {
				if (options.paymentEventId === undefined) return
				await tx
					.update(paymentEvents)
					.set({ processedAt: now })
					.where(eq(paymentEvents.id, options.paymentEventId))
			}

			if (payment.status === "succeeded") {
				await markEventProcessed()
				return { alreadyConfirmed: true, needsReview: payment.needsReview }
			}
			if (!canTransitionPayment(payment.status, "succeeded")) {
				throw new ORPCError("CONFLICT", {
					message: `A ${payment.status} payment cannot be confirmed`,
				})
			}

			// Locks the Booking row. False when the Booking can no longer be paid
			// (cancelled, or already paid by another Payment): the money is
			// recorded, the Booking is left alone, and staff review it (D7).
			const bookingPaid = await this.bookingService.markPaid(
				tx,
				payment.bookingId,
				options.actorId,
				now
			)
			const needsReview = !bookingPaid

			await tx
				.update(payments)
				.set({ status: "succeeded", needsReview, updatedAt: now })
				.where(eq(payments.id, paymentId))

			// PAY-2: exactly one e-Receipt per succeeded Payment, in this same
			// transaction. The unique payment_id makes a second insert a no-op.
			const [receipt] = await tx
				.insert(receipts)
				.values({
					paymentId,
					receiptNumber: receiptNumberFor(paymentId, now),
					verificationToken: newVerificationToken(),
					issuedAt: now,
				})
				.onConflictDoNothing({ target: receipts.paymentId })
				.returning({ id: receipts.id, receiptNumber: receipts.receiptNumber })
			if (receipt) {
				await this.auditService.record(
					{
						domain: AUDIT_DOMAIN_PAYMENTS,
						action: "receipt.issue",
						actorId: options.actorId,
						targetType: "receipt",
						targetId: String(receipt.id),
						oldValue: null,
						newValue: { paymentId, receiptNumber: receipt.receiptNumber },
					},
					tx
				)
			}

			// NTF-1: the client always gets the e-Receipt. The booking QR goes only
			// with a Booking that actually became paid; late money on a cancelled
			// (or already paid) Booking gets the review message instead (D7).
			await NotificationService.enqueue(
				tx,
				payment.bookingId,
				bookingPaid ? "payment_received" : "payment_received_review",
				`payment:${paymentId}:succeeded`,
				{ paymentId }
			)

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PAYMENTS,
					action: "payment.succeeded",
					actorId: options.actorId,
					targetType: "payment",
					targetId: String(paymentId),
					oldValue: { status: payment.status },
					newValue: {
						status: "succeeded",
						bookingId: payment.bookingId,
						amountCentavos: payment.amountCentavos,
						needsReview,
					},
				},
				tx
			)
			await markEventProcessed()

			if (needsReview) {
				this.alert("paid_unpayable_booking", { paymentId, bookingId: payment.bookingId })
			}
			return { alreadyConfirmed: false, needsReview }
		})
	}

	/** Move a Payment to failed or expired, if the state machine allows it. */
	private async moveTo(
		paymentId: number,
		status: Extract<PaymentStatus, "failed" | "expired">,
		actorId: string | null,
		now: Date,
		paymentEventId?: number
	): Promise<void> {
		await db.transaction(async tx => {
			const [payment] = await tx
				.select({ status: payments.status })
				.from(payments)
				.where(eq(payments.id, paymentId))
				.for("update")

			if (payment && canTransitionPayment(payment.status, status)) {
				await tx.update(payments).set({ status, updatedAt: now }).where(eq(payments.id, paymentId))
				await this.auditService.record(
					{
						domain: AUDIT_DOMAIN_PAYMENTS,
						action: `payment.${status}`,
						actorId,
						targetType: "payment",
						targetId: String(paymentId),
						oldValue: { status: payment.status },
						newValue: { status },
					},
					tx
				)
			}

			if (paymentEventId !== undefined) {
				await tx
					.update(paymentEvents)
					.set({ processedAt: now })
					.where(eq(paymentEvents.id, paymentEventId))
			}
		})
	}

	private async findByReference(providerCode: string, providerReference: string) {
		const [payment] = await db
			.select({ id: payments.id, amountCentavos: payments.amountCentavos })
			.from(payments)
			.where(
				and(
					eq(payments.providerCode, providerCode),
					eq(payments.providerReference, providerReference)
				)
			)
			.limit(1)
		return payment
	}

	/**
	 * Audit a refused attempt on someone else's (or a missing) record. Written
	 * outside any transaction: nothing changed, and the request is about to
	 * fail, which would roll a transaction back.
	 */
	private async recordDenial(
		actorId: string,
		action: string,
		targetType: string,
		targetId: number,
		found: unknown
	): Promise<void> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_PAYMENTS,
			action,
			outcome: "denied",
			actorId,
			targetType,
			targetId: String(targetId),
			reason: found ? "not_owner" : "not_found",
		})
	}

	/** A notification that needs a person to look at it. No personal data here. */
	private alert(reason: string, details: Record<string, unknown>): void {
		this.logger.error({ event: "payments.notification.alert", reason, ...details })
	}
}
