import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, sql } from "drizzle-orm"

import type { Booking, BookingItemStatus, BookingStatus, CreateBookingInput } from "@repo/contracts"
import { bookingItems, bookings, locations, scheduleSlots, services, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { env } from "@/config/env.config"

import { canTransitionItem, isTerminalItem } from "./booking-item-state"
import { canTransition, initialStatus } from "./booking-state"
import { generateReferenceNumber } from "./reference-number"

const AUDIT_DOMAIN_BOOKINGS = "bookings"

/** How many times to draw a new Reference Number when one is already taken. */
const MAX_REFERENCE_ATTEMPTS = 5

const MS_PER_MINUTE = 60_000

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** What happened when staff tried to check a Booking in (PRC-1). */
export type CheckInResult =
	| { ok: true; bookingItemIds: number[]; checkedInIds: number[] }
	| { ok: false; reason: "payment_required"; bookingStatus: BookingStatus }
	| { ok: false; reason: "no_items_here" }

/**
 * Bookings (BKG-1). The only code that changes `bookings.status`,
 * `booking_items.status` (PRC-1, CRT-1) and `schedule_slots.booked_count`
 * (DOMAIN-MODEL.md section 6).
 */
@Injectable()
export class BookingService {
	constructor(private readonly auditService: AuditService) {}

	/**
	 * Book one Service in one Schedule Slot (Flow B, steps 1 to 3).
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

			const referenceNumber = await this.unusedReferenceNumber(tx, now)
			const holdExpiresAt = new Date(now.getTime() + env.BOOKING_HOLD_MINUTES * MS_PER_MINUTE)

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
					},
				},
				tx
			)

			return {
				id: booking.id,
				referenceNumber: booking.referenceNumber,
				status: booking.status,
				kind: booking.kind,
				totalCentavos: booking.totalCentavos,
				holdExpiresAt: booking.holdExpiresAt,
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