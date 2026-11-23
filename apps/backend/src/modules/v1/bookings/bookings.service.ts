import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm"

import type { Booking, BookingItemStatus, BookingStatus, CreateBookingInput } from "@repo/contracts"
import {
	bookingItems,
	bookings,
	locations,
	payments,
	policyAcceptances,
	scheduleSlots,
	services,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import { PolicyService } from "@/common/policy/policy.service"
import { loadPoliciesForService } from "@/modules/v1/policies/policy-document-rules"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import {
	IN_FLIGHT_PAYMENT_STATUSES,
	PAYMENT_IN_FLIGHT_MINUTES,
	type BookingCancelReason,
} from "./booking-expiry"
import { canTransitionItem, isTerminalItem } from "./booking-item-state"
import { canTransition, initialStatus } from "./booking-state"
import { generateReferenceNumber } from "./reference-number"

const AUDIT_DOMAIN_BOOKINGS = "bookings"

/** Audit domain of cancellations made by the expiry job (System, no actor). */
export const AUDIT_DOMAIN_BOOKING_EXPIRY = "booking-expiry"

/** How many times to draw a new Reference Number when one is already taken. */
const MAX_REFERENCE_ATTEMPTS = 5

const MS_PER_MINUTE = 60_000

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The database, or a transaction: anything that can run a select. */
type Reader = typeof db | Transaction

/** What happened when staff tried to check a Booking in (PRC-1). */
export type CheckInResult =
	| { ok: true; bookingItemIds: number[]; checkedInIds: number[] }
	| { ok: false; reason: "payment_required"; bookingStatus: BookingStatus }
	| { ok: false; reason: "no_items_here" }

/**
 * Bookings (BKG-1). The only code that changes `bookings.status`,
 * `booking_items.status` (PRC-1, CRT-1) and `schedule_slots.booked_count`
 * (DOMAIN-MODEL.md section 6). BKG-2 adds cancelling: by the client, and by
 * the expiry job in `common/maintenance/`.
 */
@Injectable()
export class BookingService {
	constructor(
		private readonly auditService: AuditService,
		private readonly policyService: PolicyService
	) {}

	/**
	 * Book one Service in one Schedule Slot (Flow B, steps 1 to 3).
	 *
	 * ADM-9: refused unless the client accepted every written policy in effect
	 * for the Service that requires acceptance; the accepted versions are
	 * stored against the Booking in the same transaction.
	 *
	 * The slot row is locked before its capacity is read, so when two clients
	 * confirm the last place at the same moment the second waits, then sees the
	 * slot full. The booking, its item, the count and the audit entry commit
	 * together or not at all.
	 */
	async create(
		input: CreateBookingInput,
		actorId: string | null,
		now: Date = new Date()
	): Promise<Booking> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to book" })
		}

		// ADM-6: the hold comes from the `booking.hold_minutes` Policy.
		const holdMinutes = await this.policyService.get("booking.hold_minutes")

		return db.transaction(async tx => {
			// Locks the client's own row so two requests from the same client are
			// handled one after the other, and the unpaid-booking check below holds.
			await tx.select({ id: users.id }).from(users).where(eq(users.id, actorId)).for("update")

			const [unpaid] = await tx
				.select({ referenceNumber: bookings.referenceNumber })
				.from(bookings)
				.where(and(eq(bookings.clientId, actorId), eq(bookings.status, "pending_payment")))
				.limit(1)
			if (unpaid) {
				throw new ORPCError("CONFLICT", {
					message: `You already have a booking awaiting payment (${unpaid.referenceNumber}). Pay or cancel it before booking again.`,
				})
			}

			const [slot] = await tx
				.select()
				.from(scheduleSlots)
				.where(eq(scheduleSlots.id, input.scheduleSlotId))
				.for("update")
			if (!slot) {
				throw new ORPCError("NOT_FOUND", {
					message: `Schedule slot "${input.scheduleSlotId}" was not found`,
				})
			}
			if (slot.isDisabled) {
				throw new ORPCError("CONFLICT", { message: "This slot is no longer available" })
			}
			if (slot.startsAt.getTime() <= now.getTime()) {
				throw new ORPCError("CONFLICT", { message: "This slot has already started" })
			}
			if (slot.bookedCount >= slot.capacity) {
				throw new ORPCError("CONFLICT", { message: "This slot is full" })
			}

			const [service] = await tx.select().from(services).where(eq(services.id, slot.serviceId))
			if (!service?.isActive) {
				throw new ORPCError("CONFLICT", { message: "This service is not available for booking" })
			}
			const [location] = await tx.select().from(locations).where(eq(locations.id, slot.locationId))
			if (!location?.isActive) {
				throw new ORPCError("CONFLICT", { message: "This location is not available for booking" })
			}

			// ADM-9: every written policy in effect for this Service that requires
			// acceptance must be accepted, in the version in effect now. Read in
			// this transaction, so what is checked is what is stored.
			const accepted = new Set(input.acceptedPolicyDocumentIds)
			const applicable = await loadPoliciesForService(tx, service.id, manilaDateOf(now))
			const notAccepted = applicable.find(
				policy => policy.requiresAcceptance && !accepted.has(policy.id)
			)
			if (notAccepted) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Please read and accept "${notAccepted.title}" before booking. If you already did, it was updated while you were booking: review it again.`,
				})
			}
			const acceptedPolicies = applicable.filter(policy => accepted.has(policy.id))

			const referenceNumber = await this.unusedReferenceNumber(tx, now)
			const holdExpiresAt = new Date(now.getTime() + holdMinutes * MS_PER_MINUTE)

			const [booking] = await tx
				.insert(bookings)
				.values({
					referenceNumber,
					clientId: actorId,
					status: initialStatus("regular"),
					kind: "regular",
					totalCentavos: service.feeCentavos,
					holdExpiresAt,
					createdBy: actorId,
				})
				.returning()
			if (!booking) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Booking could not be created" })
			}

			const [item] = await tx
				.insert(bookingItems)
				.values({
					bookingId: booking.id,
					serviceId: slot.serviceId,
					scheduleSlotId: slot.id,
					locationId: slot.locationId,
					feeCentavos: service.feeCentavos,
					status: "booked",
				})
				.returning()
			if (!item) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Booking could not be created" })
			}

			if (acceptedPolicies.length > 0) {
				await tx.insert(policyAcceptances).values(
					acceptedPolicies.map(policy => ({
						bookingId: booking.id,
						policyDocumentId: policy.id,
						clientId: actorId,
						acceptedAt: now,
					}))
				)
			}

			// Counted in the database, on the locked row, so it cannot be lost.
			await tx
				.update(scheduleSlots)
				.set({ bookedCount: sql`${scheduleSlots.bookedCount} + 1`, updatedAt: now })
				.where(eq(scheduleSlots.id, slot.id))

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_BOOKINGS,
					action: "booking.create",
					actorId,
					targetType: "booking",
					targetId: String(booking.id),
					oldValue: null,
					newValue: {
						id: booking.id,
						referenceNumber: booking.referenceNumber,
						clientId: booking.clientId,
						status: booking.status,
						kind: booking.kind,
						totalCentavos: booking.totalCentavos,
						holdExpiresAt: holdExpiresAt.toISOString(),
						items: [
							{
								id: item.id,
								serviceId: item.serviceId,
								scheduleSlotId: item.scheduleSlotId,
								locationId: item.locationId,
								feeCentavos: item.feeCentavos,
								status: item.status,
							},
						],
						acceptedPolicies: acceptedPolicies.map(policy => ({
							policyDocumentId: policy.id,
							documentKey: policy.documentKey,
							version: policy.version,
						})),
					},
				},
				tx
			)

			if (booking.status === "pending_payment") {
				await NotificationService.enqueue(
					tx,
					booking.id,
					"booking_confirmed",
					`booking:${booking.id}:created`
				)
			}
			return {
				id: booking.id,
				referenceNumber: booking.referenceNumber,
				status: booking.status,
				kind: booking.kind,
				totalCentavos: booking.totalCentavos,
				holdExpiresAt: booking.holdExpiresAt,
				payOnsite: booking.payOnsite,
				cancelReason: booking.cancelReason,
				cancelledAt: booking.cancelledAt,
				createdAt: booking.createdAt,
				items: [
					{
						id: item.id,
						serviceId: item.serviceId,
						serviceName: service.name,
						locationId: item.locationId,
						locationName: location.name,
						scheduleSlotId: item.scheduleSlotId,
						startsAt: slot.startsAt,
						endsAt: slot.endsAt,
						feeCentavos: item.feeCentavos,
						status: item.status,
					},
				],
			}
		})
	}

	/**
	 * Mark a Booking paid (Flow C step 5, PAY-1).
	 *
	 * Called only by `PaymentService.confirm`, inside its transaction, so the
	 * Payment and the Booking change together or not at all. Locks the Booking
	 * row first. Returns false and changes nothing when the Booking can no
	 * longer be paid (for example it was cancelled while the client was at
	 * checkout); the caller then flags the Payment for review.
	 */
	async markPaid(
		tx: Transaction,
		bookingId: number,
		actorId: string | null,
		now: Date = new Date()
	): Promise<boolean> {
		const [booking] = await tx
			.select({ id: bookings.id, status: bookings.status })
			.from(bookings)
			.where(eq(bookings.id, bookingId))
			.for("update")
		if (!booking) {
			throw new ORPCError("NOT_FOUND", { message: `Booking "${bookingId}" was not found` })
		}
		if (!canTransition(booking.status, "paid")) {
			return false
		}

		// A paid booking keeps its slot, so the hold no longer applies.
		await tx
			.update(bookings)
			.set({ status: "paid", holdExpiresAt: null, updatedAt: now })
			.where(eq(bookings.id, bookingId))

		await this.auditService.record(
			{
				domain: AUDIT_DOMAIN_BOOKINGS,
				action: "booking.paid",
				actorId,
				targetType: "booking",
				targetId: String(bookingId),
				oldValue: { status: booking.status },
				newValue: { status: "paid" },
			},
			tx
		)
		return true
	}

	/**
	 * Check a client in at one Location (PRC-1, state machine 5.2).
	 *
	 * Locks the Booking, then its items at that Location. Annex B: no service
	 * is rendered unless payment is completed, so nothing changes unless the
	 * Booking is `paid`. Items already past `booked` are left as they are, so
	 * scanning the same QR twice is harmless. Runs in the caller's transaction.
	 */
	async checkInItems(
		tx: Transaction,
		bookingId: number,
		locationId: number,
		actorId: string,
		now: Date = new Date()
	): Promise<CheckInResult> {
		const [booking] = await tx
			.select({ id: bookings.id, status: bookings.status })
			.from(bookings)
			.where(eq(bookings.id, bookingId))
			.for("update")
		if (!booking) {
			throw new ORPCError("NOT_FOUND", { message: `Booking "${bookingId}" was not found` })
		}

		const items = await tx
			.select({ id: bookingItems.id, status: bookingItems.status })
			.from(bookingItems)
			.where(and(eq(bookingItems.bookingId, bookingId), eq(bookingItems.locationId, locationId)))
			.orderBy(asc(bookingItems.id))
			.for("update")
		if (items.length === 0) {
			return { ok: false, reason: "no_items_here" }
		}
		if (booking.status !== "paid") {
			return { ok: false, reason: "payment_required", bookingStatus: booking.status }
		}

		const toCheckIn = items.filter(item => canTransitionItem(item.status, "checked_in"))
		for (const item of toCheckIn) {
			await tx
				.update(bookingItems)
				.set({ status: "checked_in", updatedAt: now })
				.where(eq(bookingItems.id, item.id))
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_BOOKINGS,
					action: "booking_item.check_in",
					actorId,
					targetType: "booking_item",
					targetId: String(item.id),
					oldValue: { status: item.status },
					newValue: { status: "checked_in" },
				},
				tx
			)
		}

		return {
			ok: true,
			bookingItemIds: items.map(item => item.id),
			checkedInIds: toCheckIn.map(item => item.id),
		}
	}

	/**
	 * Move one Booking Item along state machine 5.2 (PRC-1).
	 *
	 * Locks the item, refuses any move that is not an arrow in the machine or
	 * that starts from a status the caller does not expect, then writes the
	 * item and its Audit Entry in the caller's transaction. Asking for
	 * `cleared` from `in_assessment` gives `pending_head_approval` instead when
	 * the Service has `requires_approval`. Returns the status actually set.
	 */
	async transitionItem(
		tx: Transaction,
		bookingItemId: number,
		to: BookingItemStatus,
		options: { actorId: string; allowedFrom: readonly BookingItemStatus[]; now?: Date }
	): Promise<{ from: BookingItemStatus; to: BookingItemStatus }> {
		const now = options.now ?? new Date()
		const [item] = await tx
			.select({
				id: bookingItems.id,
				status: bookingItems.status,
				bookingId: bookingItems.bookingId,
				serviceId: bookingItems.serviceId,
			})
			.from(bookingItems)
			.where(eq(bookingItems.id, bookingItemId))
			.for("update")
		if (!item) {
			throw new ORPCError("NOT_FOUND", { message: `Booking item "${bookingItemId}" was not found` })
		}

		let target = to
		if (to === "cleared" && item.status === "in_assessment") {
			const [service] = await tx
				.select({ requiresApproval: services.requiresApproval })
				.from(services)
				.where(eq(services.id, item.serviceId))
			if (service?.requiresApproval) target = "pending_head_approval"
		}

		if (!options.allowedFrom.includes(item.status) || !canTransitionItem(item.status, target)) {
			throw new ORPCError("CONFLICT", {
				message: `This item is ${item.status.replaceAll("_", " ")} and cannot be moved to ${target.replaceAll("_", " ")}`,
			})
		}

		await tx
			.update(bookingItems)
			.set({ status: target, updatedAt: now })
			.where(eq(bookingItems.id, item.id))

		await this.auditService.record(
			{
				domain: AUDIT_DOMAIN_BOOKINGS,
				action: `booking_item.${target}`,
				actorId: options.actorId,
				targetType: "booking_item",
				targetId: String(item.id),
				oldValue: { status: item.status },
				newValue: { status: target },
			},
			tx
		)

		if (target === "returned" || target === "rejected") {
			await NotificationService.enqueue(
				tx,
				item.bookingId,
				target === "returned" ? "assessment_returned" : "assessment_rejected",
				`booking-item:${item.id}:${target}:${now.toISOString()}`
			)
		}
		return { from: item.status, to: target }
	}

	/**
	 * Complete a paid Booking once every item is final (state machine 5.1:
	 * `paid` to `completed` when each item is `issued`, `rejected` or
	 * `no_show`). Called by `DocumentService.issue` in its transaction (CRT-1).
	 * Returns false and changes nothing while any item is still open, or when
	 * the Booking is not `paid`.
	 */
	async completeIfAllItemsFinal(
		tx: Transaction,
		bookingId: number,
		actorId: string | null,
		now: Date = new Date()
	): Promise<boolean> {
		const [booking] = await tx
			.select({ id: bookings.id, status: bookings.status })
			.from(bookings)
			.where(eq(bookings.id, bookingId))
			.for("update")
		if (!booking) {
			throw new ORPCError("NOT_FOUND", { message: `Booking "${bookingId}" was not found` })
		}

		// Locked too, so no item changes between this check and the update.
		const items = await tx
			.select({ status: bookingItems.status })
			.from(bookingItems)
			.where(eq(bookingItems.bookingId, bookingId))
			.orderBy(asc(bookingItems.id))
			.for("update")
		if (items.length === 0 || !items.every(item => isTerminalItem(item.status))) return false
		if (!canTransition(booking.status, "completed")) return false

		await tx
			.update(bookings)
			.set({ status: "completed", updatedAt: now })
			.where(eq(bookings.id, bookingId))
		await this.auditService.record(
			{
				domain: AUDIT_DOMAIN_BOOKINGS,
				action: "booking.completed",
				actorId,
				targetType: "booking",
				targetId: String(bookingId),
				oldValue: { status: booking.status },
				newValue: { status: "completed" },
			},
			tx
		)
		return true
	}

	/**
	 * The caller's one Booking awaiting payment, or null (BKG-2). The client
	 * dashboard shows it with Pay now, Pay at the office and Cancel.
	 */
	async findUnpaid(actorId: string | null): Promise<Booking | null> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to view your bookings" })
		}
		const [unpaid] = await db
			.select({ id: bookings.id })
			.from(bookings)
			.where(and(eq(bookings.clientId, actorId), eq(bookings.status, "pending_payment")))
			.limit(1)
		return unpaid ? this.loadBooking(db, unpaid.id) : null
	}

	/**
	 * The client cancels their own unpaid Booking (BKG-2, `bookings.own:cancel`).
	 *
	 * Someone else's Booking answers exactly like a missing one, so ids cannot
	 * be probed; the attempt is audited as denied. Refused while a Payment for
	 * it is still in flight, because the money may already be on its way.
	 */
	async cancelOwn(
		bookingId: number,
		actorId: string | null,
		now: Date = new Date()
	): Promise<Booking> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to cancel a booking" })
		}

		const denied = await db.transaction(async tx => {
			const [owned] = await tx
				.select({ clientId: bookings.clientId, status: bookings.status })
				.from(bookings)
				.where(eq(bookings.id, bookingId))
				.for("update")
			if (!owned || owned.clientId !== actorId) {
				return owned ? "not_owner" : "not_found"
			}
			if (owned.status !== "pending_payment") {
				throw new ORPCError("CONFLICT", {
					message: "Only a booking that is awaiting payment can be cancelled",
				})
			}
			if (await this.hasPaymentInFlight(tx, bookingId, now)) {
				throw new ORPCError("CONFLICT", {
					message:
						"A payment for this booking is still being processed. Please wait for it to finish before cancelling.",
				})
			}
			await this.cancel(tx, bookingId, "client_cancelled", { actorId, now })
			return null
		})

		if (denied) {
			await this.recordDenial(actorId, "booking.cancel", bookingId, denied)
			throw new ORPCError("NOT_FOUND", { message: "Booking not found" })
		}
		return this.loadBooking(db, bookingId)
	}

	/**
	 * The client will pay at the BOQ cashier (BKG-2). The hold stops applying;
	 * the expiry job cancels the Booking as `no_show` if it is still unpaid
	 * when the arrival cutoff passes. Choosing it twice changes nothing.
	 */
	async choosePayOnsite(
		bookingId: number,
		actorId: string | null,
		now: Date = new Date()
	): Promise<Booking> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to change how you pay" })
		}

		const denied = await db.transaction(async tx => {
			const [owned] = await tx
				.select({
					clientId: bookings.clientId,
					status: bookings.status,
					payOnsite: bookings.payOnsite,
					holdExpiresAt: bookings.holdExpiresAt,
				})
				.from(bookings)
				.where(eq(bookings.id, bookingId))
				.for("update")
			if (!owned || owned.clientId !== actorId) {
				return owned ? "not_owner" : "not_found"
			}
			if (owned.status !== "pending_payment") {
				throw new ORPCError("CONFLICT", { message: "This booking is not awaiting payment" })
			}
			if (owned.payOnsite) return null

			await tx
				.update(bookings)
				.set({ payOnsite: true, holdExpiresAt: null, updatedAt: now })
				.where(eq(bookings.id, bookingId))
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_BOOKINGS,
					action: "booking.pay_onsite",
					actorId,
					targetType: "booking",
					targetId: String(bookingId),
					oldValue: {
						payOnsite: false,
						holdExpiresAt: owned.holdExpiresAt?.toISOString() ?? null,
					},
					newValue: { payOnsite: true, holdExpiresAt: null },
				},
				tx
			)
			return null
		})

		if (denied) {
			await this.recordDenial(actorId, "booking.pay_onsite", bookingId, denied)
			throw new ORPCError("NOT_FOUND", { message: "Booking not found" })
		}
		return this.loadBooking(db, bookingId)
	}

	/**
	 * Cancel an unpaid Booking and give back one place in each item's slot, in
	 * the caller's transaction (BKG-2, state machine 5.1).
	 *
	 * Locks the Booking row first and re-reads its status, so a Booking that
	 * another run (or a payment) already moved on is left alone: returns false
	 * and changes nothing. That is what makes a second, concurrent expiry run
	 * cancel nothing and release nothing. A null actor is the System (the
	 * expiry job); its audit entry has no actor and names the job.
	 */
	async cancel(
		tx: Transaction,
		bookingId: number,
		reason: BookingCancelReason,
		options: { actorId: string | null; now?: Date }
	): Promise<boolean> {
		const now = options.now ?? new Date()
		const [booking] = await tx
			.select({ id: bookings.id, status: bookings.status })
			.from(bookings)
			.where(eq(bookings.id, bookingId))
			.for("update")
		if (!booking) {
			throw new ORPCError("NOT_FOUND", { message: `Booking "${bookingId}" was not found` })
		}
		if (!canTransition(booking.status, "cancelled")) return false

		const items = await tx
			.select({ id: bookingItems.id, scheduleSlotId: bookingItems.scheduleSlotId })
			.from(bookingItems)
			.where(eq(bookingItems.bookingId, bookingId))
			.orderBy(asc(bookingItems.scheduleSlotId), asc(bookingItems.id))

		await tx
			.update(bookings)
			.set({
				status: "cancelled",
				cancelReason: reason,
				cancelledAt: now,
				holdExpiresAt: null,
				updatedAt: now,
			})
			.where(eq(bookings.id, bookingId))

		// One place back per item. Slots are updated in id order, so two
		// cancellations sharing slots always lock them in the same order. The
		// count is computed by the database on the locked row, never below zero.
		for (const item of items) {
			await tx
				.update(scheduleSlots)
				.set({
					bookedCount: sql`greatest(${scheduleSlots.bookedCount} - 1, 0)`,
					updatedAt: now,
				})
				.where(eq(scheduleSlots.id, item.scheduleSlotId))
		}

		await this.auditService.record(
			{
				domain: options.actorId ? AUDIT_DOMAIN_BOOKINGS : AUDIT_DOMAIN_BOOKING_EXPIRY,
				action: "booking.cancelled",
				actorId: options.actorId,
				targetType: "booking",
				targetId: String(bookingId),
				oldValue: { status: booking.status },
				newValue: {
					status: "cancelled",
					cancelReason: reason,
					releasedScheduleSlotIds: items.map(item => item.scheduleSlotId),
				},
			},
			tx
		)
		await NotificationService.enqueue(
			tx,
			bookingId,
			"booking_cancelled",
			`booking:${bookingId}:cancelled`
		)
		return true
	}

	/**
	 * Whether the Booking has a Payment that may still succeed: `initiated` or
	 * `pending` and younger than the payment timeout. While it does, the
	 * Booking is neither expired nor cancelled by the client (BKG-2).
	 */
	async hasPaymentInFlight(reader: Reader, bookingId: number, now: Date): Promise<boolean> {
		const since = new Date(now.getTime() - PAYMENT_IN_FLIGHT_MINUTES * MS_PER_MINUTE)
		const [inFlight] = await reader
			.select({ id: payments.id })
			.from(payments)
			.where(
				and(
					eq(payments.bookingId, bookingId),
					inArray(payments.status, [...IN_FLIGHT_PAYMENT_STATUSES]),
					gt(payments.createdAt, since)
				)
			)
			.limit(1)
		return Boolean(inFlight)
	}

	/** One Booking with its items, as the API returns it. */
	private async loadBooking(reader: Reader, bookingId: number): Promise<Booking> {
		const [booking] = await reader
			.select()
			.from(bookings)
			.where(eq(bookings.id, bookingId))
			.limit(1)
		if (!booking) {
			throw new ORPCError("NOT_FOUND", { message: "Booking not found" })
		}

		const items = await reader
			.select({
				id: bookingItems.id,
				serviceId: bookingItems.serviceId,
				serviceName: services.name,
				locationId: bookingItems.locationId,
				locationName: locations.name,
				scheduleSlotId: bookingItems.scheduleSlotId,
				startsAt: scheduleSlots.startsAt,
				endsAt: scheduleSlots.endsAt,
				feeCentavos: bookingItems.feeCentavos,
				status: bookingItems.status,
			})
			.from(bookingItems)
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.innerJoin(scheduleSlots, eq(scheduleSlots.id, bookingItems.scheduleSlotId))
			.where(eq(bookingItems.bookingId, bookingId))
			.orderBy(asc(bookingItems.id))

		return {
			id: booking.id,
			referenceNumber: booking.referenceNumber,
			status: booking.status,
			kind: booking.kind,
			totalCentavos: booking.totalCentavos,
			holdExpiresAt: booking.holdExpiresAt,
			payOnsite: booking.payOnsite,
			cancelReason: booking.cancelReason,
			cancelledAt: booking.cancelledAt,
			createdAt: booking.createdAt,
			items,
		}
	}

	/**
	 * Audit a refused attempt on someone else's (or a missing) Booking. Written
	 * outside any transaction: nothing changed, and the request is about to fail.
	 */
	private async recordDenial(
		actorId: string,
		action: string,
		bookingId: number,
		reason: "not_owner" | "not_found"
	): Promise<void> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_BOOKINGS,
			action,
			outcome: "denied",
			actorId,
			targetType: "booking",
			targetId: String(bookingId),
			reason,
		})
	}

	/** Draw Reference Numbers until one is not already in use. */
	private async unusedReferenceNumber(tx: Transaction, now: Date): Promise<string> {
		for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
			const referenceNumber = generateReferenceNumber(now)
			const [taken] = await tx
				.select({ id: bookings.id })
				.from(bookings)
				.where(eq(bookings.referenceNumber, referenceNumber))
				.limit(1)
			if (!taken) return referenceNumber
		}
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "A reference number could not be generated. Please try again.",
		})
	}
}
