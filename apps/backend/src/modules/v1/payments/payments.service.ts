import { Injectable, Logger } from "@nestjs/common"
import { createHash } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, isNotNull, lte, ne } from "drizzle-orm"

import type {
	CollectOnsiteInput,
	CollectOnsiteResult,
	CreatePaymentInput,
	PaymentCheckout,
	PaymentStatus,
	PaymentStatusResponse,
	ResolvePaymentReviewInput,
} from "@repo/contracts"
import {
	bookingItems,
	bookings,
	paymentChannels,
	paymentEvents,
	payments,
	receipts,
	refundRequests,
	services,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import { env } from "@/config/env.config"

import { PAYMENT_REQUERY_MINUTES } from "../bookings/booking-expiry"
import { BookingService, type Transaction } from "../bookings/bookings.service"
import { chargeFor } from "./convenience-fee"
import { PaymentChannelService } from "./payment-channels.service"
import { canTransitionPayment } from "./payment-state"
import {
	ONSITE_PROVIDER_CODE,
	type ParsedNotification,
	type RawNotification,
} from "./providers/payment-provider"
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

/** What one run of the re-query job did (PAY-6). */
export interface ReconcileResult {
	/** Asked the provider. */
	checked: number
	/** The provider said paid; confirmed through `confirm`. */
	confirmed: number
	/** The provider said failed or expired. */
	closed: number
	/** Still pending at the provider; asked again next interval. */
	stillPending: number
	/** Paid, but for a different amount: left alone and alerted. */
	amountMismatch: number
	/** The provider could not be asked (unknown code, network error). */
	failed: number
}

export interface ConfirmResult {
	/** True when an earlier notification already confirmed this payment. */
	alreadyConfirmed: boolean
	/** True when money arrived for a Booking that can no longer be paid. */
	needsReview: boolean
}

/** How each tender type reads on the e-Receipt's "Payment channel" line (PAY-4). */
const TENDER_LABELS: Record<CollectOnsiteInput["tenderType"], string> = {
	cash: "Cash",
	card: "Card",
	check: "Check",
}

/** The receipt's channel name for a payment taken at the cashier, e.g. "Onsite cashier - Cash". */
export function onsiteChannelName(tenderType: CollectOnsiteInput["tenderType"] | null): string {
	return tenderType ? `Onsite cashier - ${TENDER_LABELS[tenderType]}` : "Onsite cashier"
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
		private readonly providers: PaymentProviderRegistry,
		private readonly channels: PaymentChannelService
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

		// PAY-5: the channel decides the provider and the fee. Read on every
		// payment, so a provider switch in settings applies to the next one.
		const usable = await this.channels.findUsable(input.channelCode)
		if (!usable) {
			throw new ORPCError("BAD_REQUEST", { message: "This payment channel is not available" })
		}
		const { channel, provider } = usable

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

		// The same function checkout used to show the fee, so the client pays
		// exactly what they saw; the Receipt prints these stored figures.
		const { convenienceFeeCentavos, totalCentavos: amountCentavos } = chargeFor(
			booking.totalCentavos,
			channel
		)

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
					channelCode: channel.code,
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
		const { alreadyConfirmed, needsReview } = await db.transaction(tx =>
			this.confirmInTx(tx, paymentId, options, now)
		)
		return { alreadyConfirmed, needsReview }
	}

	/**
	 * `confirm` inside a transaction the caller already holds. The cashier flow
	 * (PAY-4) uses it so the onsite Payment is created and confirmed together:
	 * either the booking is paid with its receipt, or nothing was written.
	 */
	private async confirmInTx(
		tx: Transaction,
		paymentId: number,
		options: { actorId: string | null; paymentEventId?: number },
		now: Date
	): Promise<ConfirmResult & { receiptNumber: string | null }> {
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
			return { alreadyConfirmed: true, needsReview: payment.needsReview, receiptNumber: null }
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

		// PAY-6: why it needs review. A Booking another Payment already paid
		// makes this one a duplicate: real money, recorded, but no second
		// receipt. Otherwise the Booking was closed (cancelled, forfeited) before
		// the money arrived: a late payment, with a receipt as proof.
		let reviewReason: "duplicate" | "late_payment" | null = null
		if (needsReview) {
			const [earlier] = await tx
				.select({ id: payments.id })
				.from(payments)
				.where(
					and(
						eq(payments.bookingId, payment.bookingId),
						eq(payments.status, "succeeded"),
						ne(payments.id, paymentId)
					)
				)
				.limit(1)
			reviewReason = earlier ? "duplicate" : "late_payment"
		}

		await tx
			.update(payments)
			.set({ status: "succeeded", needsReview, updatedAt: now })
			.where(eq(payments.id, paymentId))

		let receipt: { id: number; receiptNumber: string } | undefined
		if (reviewReason !== "duplicate") {
			// PAY-2a: the receipt keeps the names as they are right now, so a later
			// rename of the client, channel or Service never changes a reprint.
			const [names] = await tx
				.select({ clientName: users.name, channelName: paymentChannels.name })
				.from(bookings)
				.innerJoin(users, eq(users.id, bookings.clientId))
				.leftJoin(paymentChannels, eq(paymentChannels.code, payment.channelCode))
				.where(eq(bookings.id, payment.bookingId))
				.limit(1)
			if (!names) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Booking not found for payment" })
			}
			const serviceLines = await tx
				.select({ serviceName: services.name, feeCentavos: bookingItems.feeCentavos })
				.from(bookingItems)
				.innerJoin(services, eq(services.id, bookingItems.serviceId))
				.where(eq(bookingItems.bookingId, payment.bookingId))
				.orderBy(asc(bookingItems.id))
			// PAY-2: exactly one e-Receipt per succeeded Payment, in this same
			// transaction. The unique payment_id makes a second insert a no-op.
			const issued = await tx
				.insert(receipts)
				.values({
					paymentId,
					receiptNumber: receiptNumberFor(paymentId, now),
					verificationToken: newVerificationToken(),
					clientName: names.clientName,
					// Payments made before PAY-5 have a channel code with no row; keep the code.
					// Cashier payments (PAY-4) name the tender instead.
					channelName:
						names.channelName ??
						(payment.providerCode === ONSITE_PROVIDER_CODE
							? onsiteChannelName(payment.tenderType)
							: payment.channelCode),
					serviceLines,
					issuedAt: now,
				})
				.onConflictDoNothing({ target: receipts.paymentId })
				.returning({ id: receipts.id, receiptNumber: receipts.receiptNumber })
			receipt = issued[0]
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
		}

		// NTF-1: the client gets proof of payment. The booking QR goes only with
		// a Booking that actually became paid; late money on a closed Booking
		// gets the review message with its receipt (D7), and a duplicate gets
		// the review message alone (PAY-6). Both say BOQ will contact them.
		await NotificationService.enqueue(
			tx,
			payment.bookingId,
			bookingPaid
				? "payment_received"
				: reviewReason === "duplicate"
					? "payment_duplicate_review"
					: "payment_received_review",
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
					...(reviewReason ? { reviewReason } : {}),
				},
			},
			tx
		)
		await markEventProcessed()

		if (needsReview) {
			this.alert(reviewReason === "duplicate" ? "duplicate_payment" : "paid_unpayable_booking", {
				paymentId,
				bookingId: payment.bookingId,
			})
		}
		return { alreadyConfirmed: false, needsReview, receiptNumber: receipt?.receiptNumber ?? null }
	}

	/**
	 * Record a payment taken at a BOQ cashier (PAY-4, Flow C cashier branch).
	 *
	 * One transaction: lock the Booking, check it is still awaiting payment and
	 * still costs what the cashier saw, create a Payment with provider
	 * `onsite` and `collected_by` set to the cashier, then confirm it through
	 * the same `confirm` online payments use (Booking paid, e-Receipt issued).
	 * Onsite payments carry no convenience fee.
	 *
	 * Scope is checked by the caller (CashierService) before this runs.
	 */
	async collectOnsite(
		input: CollectOnsiteInput,
		cashierId: string,
		now: Date = new Date()
	): Promise<CollectOnsiteResult> {
		const provider = this.providers.find(ONSITE_PROVIDER_CODE)
		if (!provider) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Onsite payments are not set up" })
		}

		return db.transaction(async (tx): Promise<CollectOnsiteResult> => {
			const [booking] = await tx
				.select({
					id: bookings.id,
					status: bookings.status,
					referenceNumber: bookings.referenceNumber,
					totalCentavos: bookings.totalCentavos,
				})
				.from(bookings)
				.where(eq(bookings.id, input.bookingId))
				.for("update")
			if (!booking) {
				throw new ORPCError("NOT_FOUND", { message: "Booking not found" })
			}
			// A second click, another cashier, or an online payment may have got
			// here first. Refuse and say what the booking is now.
			if (booking.status !== "pending_payment") {
				throw new ORPCError("CONFLICT", {
					message: `Booking ${booking.referenceNumber} cannot be paid: it is ${booking.status.replace(/_/g, " ")}`,
					data: { status: booking.status },
				})
			}
			if (booking.totalCentavos !== input.amountDueCentavos) {
				throw new ORPCError("CONFLICT", {
					message: "The amount due has changed. Open the booking again before collecting.",
					data: { status: booking.status, totalCentavos: booking.totalCentavos },
				})
			}

			const amountCentavos = booking.totalCentavos
			const [row] = await tx
				.insert(payments)
				.values({
					bookingId: booking.id,
					channelCode: ONSITE_PROVIDER_CODE,
					providerCode: ONSITE_PROVIDER_CODE,
					amountCentavos,
					convenienceFeeCentavos: 0,
					status: "pending",
					collectedBy: cashierId,
					tenderType: input.tenderType,
					createdAt: now,
					updatedAt: now,
				})
				.returning({ id: payments.id })
			if (!row) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Payment could not be created" })
			}

			const session = await provider.createCheckout({
				paymentId: row.id,
				referenceNumber: booking.referenceNumber,
				amountCentavos,
				description: `QSPS booking ${booking.referenceNumber}`,
				returnUrl: `${env.APP_WEB_URL}/cashier`,
				notifyUrl: `${env.PAYMENT_NOTIFY_BASE_URL}/v1/payments/notifications/${provider.code}`,
			})
			await tx
				.update(payments)
				.set({ providerReference: session.providerReference })
				.where(eq(payments.id, row.id))

			const changeCentavos = input.amountReceivedCentavos - amountCentavos
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PAYMENTS,
					action: "payment.collect_onsite",
					actorId: cashierId,
					targetType: "payment",
					targetId: String(row.id),
					oldValue: null,
					newValue: {
						id: row.id,
						bookingId: booking.id,
						providerCode: ONSITE_PROVIDER_CODE,
						amountCentavos,
						tenderType: input.tenderType,
						amountReceivedCentavos: input.amountReceivedCentavos,
						changeCentavos,
						collectedBy: cashierId,
					},
				},
				tx
			)

			const confirmed = await this.confirmInTx(tx, row.id, { actorId: cashierId }, now)
			if (!confirmed.receiptNumber) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The receipt could not be issued" })
			}

			return {
				paymentId: row.id,
				receiptNumber: confirmed.receiptNumber,
				amountCentavos,
				changeCentavos,
				bookingStatus: "paid",
			}
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
	/**
	 * The re-query job (PAY-6, Flow C failure branch). For each Payment still
	 * `pending` and not heard from for `PAYMENT_REQUERY_MINUTES`, ask the
	 * provider (`queryStatus`) and apply the answer:
	 *
	 * - paid, for the right amount → `confirm` (Booking paid, or the Payment
	 *   flagged for review when the Booking was closed or already paid)
	 * - failed or expired → the Payment moves there
	 * - still pending → `updated_at` is touched, so it is asked again after the
	 *   interval and keeps its Booking from expiring (the deferral rule in
	 *   `PAYMENT_IN_FLIGHT_MINUTES`)
	 * - paid for a different amount → nothing changes; alerted for staff
	 *
	 * The provider is asked outside any transaction, so a slow gateway holds no
	 * locks. Every change goes through the same code as a notification would,
	 * and is audited as a system action (no actor). Oldest-checked first, at
	 * most `batchSize` a run.
	 */
	async reconcilePending(now: Date = new Date(), batchSize = 50): Promise<ReconcileResult> {
		const dueBefore = new Date(now.getTime() - PAYMENT_REQUERY_MINUTES * 60_000)
		const due = await db
			.select({
				id: payments.id,
				providerCode: payments.providerCode,
				providerReference: payments.providerReference,
				amountCentavos: payments.amountCentavos,
			})
			.from(payments)
			.where(
				and(
					eq(payments.status, "pending"),
					lte(payments.updatedAt, dueBefore),
					isNotNull(payments.providerReference),
					// The cashier confirms onsite payments itself; there is no one to ask.
					ne(payments.providerCode, ONSITE_PROVIDER_CODE)
				)
			)
			.orderBy(asc(payments.updatedAt), asc(payments.id))
			.limit(batchSize)

		const result: ReconcileResult = {
			checked: 0,
			confirmed: 0,
			closed: 0,
			stillPending: 0,
			amountMismatch: 0,
			failed: 0,
		}

		for (const payment of due) {
			const provider = this.providers.find(payment.providerCode)
			if (!provider || !payment.providerReference) {
				result.failed++
				this.alert("requery_unknown_provider", {
					paymentId: payment.id,
					providerCode: payment.providerCode,
				})
				await this.touchPending(payment.id, now)
				continue
			}

			try {
				const status = await provider.queryStatus(payment.providerReference)
				result.checked++
				if (status.status === "succeeded") {
					if (status.amountCentavos !== payment.amountCentavos) {
						result.amountMismatch++
						this.alert("amount_mismatch", {
							source: "requery",
							paymentId: payment.id,
							expectedCentavos: payment.amountCentavos,
							reportedCentavos: status.amountCentavos,
						})
						await this.touchPending(payment.id, now)
						continue
					}
					await this.confirm(payment.id, { actorId: null }, now)
					result.confirmed++
				} else if (status.status === "failed" || status.status === "expired") {
					await this.moveTo(payment.id, status.status, null, now)
					result.closed++
				} else {
					await this.touchPending(payment.id, now)
					result.stillPending++
				}
			} catch (error) {
				// One unreachable gateway or bad row must not stop the rest.
				result.failed++
				this.logger.error({
					event: "payments.requery.failed",
					paymentId: payment.id,
					providerCode: payment.providerCode,
					error: error instanceof Error ? error.message : String(error),
				})
				await this.touchPending(payment.id, now).catch(() => undefined)
			}
		}
		return result
	}

	/**
	 * Resolve a payment exception (PAY-6): staff rebooked the client, or opened
	 * a Refund Request for the money. Recorded on the Payment (who, when, how,
	 * why) and audited in one transaction; a Payment is resolved once.
	 *
	 * Scope and `bookings.all:override` are checked by the caller
	 * (PaymentExceptionsService and RbacGuard).
	 */
	async resolveReview(
		input: ResolvePaymentReviewInput,
		actorId: string,
		now: Date = new Date()
	): Promise<{ paymentId: number; resolution: ResolvePaymentReviewInput["resolution"]; refundRequestId: number | null }> {
		return db.transaction(async tx => {
			const [payment] = await tx
				.select({
					id: payments.id,
					bookingId: payments.bookingId,
					status: payments.status,
					needsReview: payments.needsReview,
					reviewResolution: payments.reviewResolution,
				})
				.from(payments)
				.where(eq(payments.id, input.paymentId))
				.for("update")
			if (!payment) {
				throw new ORPCError("NOT_FOUND", { message: "Payment not found" })
			}
			if (payment.status !== "succeeded" || !payment.needsReview) {
				throw new ORPCError("CONFLICT", { message: "This payment does not need review" })
			}
			if (payment.reviewResolution) {
				throw new ORPCError("CONFLICT", {
					message: "This payment was already resolved",
					data: { resolution: payment.reviewResolution },
				})
			}

			let rebookedBookingId: number | null = null
			if (input.resolution === "rebooked") {
				const reference = input.rebookedReferenceNumber?.trim().toUpperCase() ?? ""
				const [original] = await tx
					.select({ clientId: bookings.clientId })
					.from(bookings)
					.where(eq(bookings.id, payment.bookingId))
					.limit(1)
				const [rebooked] = await tx
					.select({ id: bookings.id, clientId: bookings.clientId })
					.from(bookings)
					.where(eq(bookings.referenceNumber, reference))
					.limit(1)
				if (!rebooked || !original || rebooked.clientId !== original.clientId) {
					throw new ORPCError("BAD_REQUEST", {
						message: "Enter the Reference Number of the new booking made for this client",
					})
				}
				if (rebooked.id === payment.bookingId) {
					throw new ORPCError("BAD_REQUEST", {
						message: "The new booking must be a different booking",
					})
				}
				rebookedBookingId = rebooked.id
			}

			let refundRequestId: number | null = null
			if (input.resolution === "refund_requested") {
				const [request] = await tx
					.insert(refundRequests)
					.values({
						bookingId: payment.bookingId,
						paymentId: payment.id,
						kind: "refund",
						status: "requested",
						reason: input.note,
						requestedBy: actorId,
						createdAt: now,
						updatedAt: now,
					})
					.returning({ id: refundRequests.id })
				refundRequestId = request?.id ?? null
			}

			await tx
				.update(payments)
				.set({
					reviewResolution: input.resolution,
					reviewNote: input.note,
					rebookedBookingId,
					reviewedBy: actorId,
					reviewedAt: now,
					updatedAt: now,
				})
				.where(eq(payments.id, payment.id))

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PAYMENTS,
					action: "payment.review.resolve",
					actorId,
					targetType: "payment",
					targetId: String(payment.id),
					oldValue: { needsReview: true, reviewResolution: null },
					newValue: {
						reviewResolution: input.resolution,
						bookingId: payment.bookingId,
						...(rebookedBookingId !== null ? { rebookedBookingId } : {}),
						...(refundRequestId !== null ? { refundRequestId } : {}),
					},
				},
				tx
			)

			return { paymentId: payment.id, resolution: input.resolution, refundRequestId }
		})
	}

	/** Still pending at the provider: ask again after the interval (PAY-6). */
	private async touchPending(paymentId: number, now: Date): Promise<void> {
		await db
			.update(payments)
			.set({ updatedAt: now })
			.where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
	}

	private alert(reason: string, details: Record<string, unknown>): void {
		this.logger.error({ event: "payments.notification.alert", reason, ...details })
	}
}
