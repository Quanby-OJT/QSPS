import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm"

import type {
	BookingItemIdParam,
	BookingStatus,
	CheckInInput,
	CheckInResponse,
	ProcessingItem,
	ProcessingQueue,
	ProcessingQueueRequest,
	QueuePaymentStatus,
	RecordAssessmentInput,
} from "@repo/contracts"
import {
	assessments,
	bookingItems,
	bookings,
	locations,
	scheduleSlots,
	services,
	users,
} from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { BookingService } from "../bookings/bookings.service"
import { manilaDateOf, manilaDateTimeToUtc } from "../schedules/manila-time"

const AUDIT_DOMAIN_PROCESSING = "processing"

const MS_PER_DAY = 86_400_000

/**
 * Bookings staff work on. A cancelled, rejected or refunded Booking has
 * nothing left to assess, so it stays out of the queue.
 */
const QUEUE_BOOKING_STATUSES: BookingStatus[] = ["pending_payment", "paid", "completed"]

/** Annex B: Paid is `paid` or `completed`. */
function paymentStatusOf(status: BookingStatus): QueuePaymentStatus {
	return status === "paid" || status === "completed" ? "paid" : "unpaid"
}

/** The same answer for "not there" and "not yours", so other Locations cannot be probed. */
function itemNotFound() {
	return new ORPCError("NOT_FOUND", { message: "Booking item not found at your location" })
}

interface StaffLocation {
	id: number
	name: string
}

/**
 * BOQ staff assessment (PRC-1, TOR §VIII.3).
 *
 * Every read and write is limited to the staff user's Location claim
 * (`users.location_id`) until ADM-2 adds `ScopeService`. Item status changes
 * go through `BookingService`; this service writes only `assessments`.
 */
@Injectable()
export class ProcessingService {
	constructor(
		private readonly bookingService: BookingService,
		private readonly auditService: AuditService
	) {}

	/** Booking Items at the caller's Location for one Manila date, earliest first. */
	async queue(
		input: ProcessingQueueRequest,
		actorId: string | null,
		now: Date = new Date()
	): Promise<ProcessingQueue> {
		const staffId = requireActor(actorId)
		const date = input.date ?? manilaDateOf(now)
		const location = await this.staffLocation(staffId)
		if (!location) {
			return { location: null, date, items: [] }
		}

		const dayStart = manilaDateTimeToUtc(date, "00:00")
		const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY)

		const rows = await db
			.select({
				bookingItemId: bookingItems.id,
				status: bookingItems.status,
				referenceNumber: bookings.referenceNumber,
				bookingStatus: bookings.status,
				clientName: users.name,
				serviceName: services.name,
				startsAt: scheduleSlots.startsAt,
				endsAt: scheduleSlots.endsAt,
			})
			.from(bookingItems)
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(scheduleSlots, eq(scheduleSlots.id, bookingItems.scheduleSlotId))
			.where(
				and(
					eq(bookingItems.locationId, location.id),
					gte(scheduleSlots.startsAt, dayStart),
					lt(scheduleSlots.startsAt, dayEnd),
					inArray(bookings.status, QUEUE_BOOKING_STATUSES)
				)
			)
			.orderBy(asc(scheduleSlots.startsAt), asc(bookings.referenceNumber))

		return {
			location,
			date,
			items: rows.map(row => ({
				...row,
				paymentStatus: paymentStatusOf(row.bookingStatus),
			})),
		}
	}

	/** One Booking Item with the client's profile and assessment history. */
	async item(input: BookingItemIdParam, actorId: string | null): Promise<ProcessingItem> {
		const staffId = requireActor(actorId)
		await this.requireItemInScope(input.bookingItemId, staffId, "booking_item.read")
		return this.loadItem(input.bookingItemId)
	}

	/**
	 * Check a client in by Reference Number (from the QR code or typed).
	 * Refused with "Payment required" unless the Booking is paid (Annex B).
	 */
	async checkIn(input: CheckInInput, actorId: string | null): Promise<CheckInResponse> {
		const staffId = requireActor(actorId)
		const location = await this.staffLocation(staffId)

		const [booking] = await db
			.select({ id: bookings.id })
			.from(bookings)
			.where(eq(bookings.referenceNumber, input.referenceNumber))
			.limit(1)
		if (!booking) {
			throw new ORPCError("NOT_FOUND", {
				message: `No booking has the reference number ${input.referenceNumber}`,
			})
		}
		if (!location) {
			await this.recordDenial(
				staffId,
				"booking_item.check_in",
				"booking",
				booking.id,
				"no_location"
			)
			throw new ORPCError("NOT_FOUND", {
				message: `No booking ${input.referenceNumber} at your location`,
			})
		}

		const result = await db.transaction(tx =>
			this.bookingService.checkInItems(tx, booking.id, location.id, staffId)
		)

		if (!result.ok && result.reason === "no_items_here") {
			await this.recordDenial(
				staffId,
				"booking_item.check_in",
				"booking",
				booking.id,
				"outside_scope"
			)
			throw new ORPCError("NOT_FOUND", {
				message: `No booking ${input.referenceNumber} at your location`,
			})
		}
		if (!result.ok) {
			await this.recordDenial(
				staffId,
				"booking_item.check_in",
				"booking",
				booking.id,
				"payment_required"
			)
			throw new ORPCError("CONFLICT", {
				message: `Payment required: booking ${input.referenceNumber} is not paid yet, so the client cannot be checked in.`,
			})
		}

		const items = await Promise.all(result.bookingItemIds.map(id => this.loadItem(id)))
		return { items }
	}

	/** Start assessing: `checked_in` (or `returned`, after the client corrects it) to `in_assessment`. */
	async open(input: BookingItemIdParam, actorId: string | null): Promise<ProcessingItem> {
		const staffId = requireActor(actorId)
		await this.requireItemInScope(input.bookingItemId, staffId, "booking_item.open")

		await db.transaction(tx =>
			this.bookingService.transitionItem(tx, input.bookingItemId, "in_assessment", {
				actorId: staffId,
				allowedFrom: ["checked_in", "returned"],
			})
		)
		return this.loadItem(input.bookingItemId)
	}

	/**
	 * Record an Assessment and move the item: cleared (or pending head
	 * approval), returned for correction, or rejected. The Assessment row, the
	 * item's new status and both Audit Entries commit together.
	 */
	async assess(input: RecordAssessmentInput, actorId: string | null): Promise<ProcessingItem> {
		const staffId = requireActor(actorId)
		await this.requireItemInScope(input.bookingItemId, staffId, "assessment.create")

		await db.transaction(async tx => {
			const moved = await this.bookingService.transitionItem(
				tx,
				input.bookingItemId,
				input.outcome,
				{ actorId: staffId, allowedFrom: ["in_assessment"] }
			)

			const notes = input.notes.length > 0 ? input.notes : null
			const [saved] = await tx
				.insert(assessments)
				.values({
					bookingItemId: input.bookingItemId,
					staffId,
					outcome: input.outcome,
					notes,
					corrections: input.corrections,
					// Set here, in UTC, rather than by the database clock (DOMAIN-MODEL.md: timestamps are UTC).
					createdAt: new Date(),
				})
				.returning({ id: assessments.id })
			if (!saved) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "The assessment could not be saved",
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PROCESSING,
					action: "assessment.create",
					actorId: staffId,
					targetType: "booking_item",
					targetId: String(input.bookingItemId),
					oldValue: { status: moved.from },
					newValue: {
						assessmentId: saved.id,
						outcome: input.outcome,
						status: moved.to,
						notes,
						corrections: input.corrections,
					},
				},
				tx
			)
		})

		return this.loadItem(input.bookingItemId)
	}

	/** The staff user's Location claim, or null when they have none. */
	private async staffLocation(staffId: string): Promise<StaffLocation | null> {
		const [row] = await db
			.select({ id: locations.id, name: locations.name })
			.from(users)
			.innerJoin(locations, eq(locations.id, users.locationId))
			.where(eq(users.id, staffId))
			.limit(1)
		return row ?? null
	}

	/**
	 * 404 unless the item exists and is at the caller's Location. A refused
	 * attempt on an item that does exist is audited as denied.
	 */
	private async requireItemInScope(
		bookingItemId: number,
		staffId: string,
		action: string
	): Promise<void> {
		const [item] = await db
			.select({ id: bookingItems.id, locationId: bookingItems.locationId })
			.from(bookingItems)
			.where(eq(bookingItems.id, bookingItemId))
			.limit(1)
		if (!item) throw itemNotFound()

		const location = await this.staffLocation(staffId)
		if (!location || location.id !== item.locationId) {
			await this.recordDenial(
				staffId,
				action,
				"booking_item",
				bookingItemId,
				location ? "outside_scope" : "no_location"
			)
			throw itemNotFound()
		}
	}

	/** Everything the assessment screen shows. Call only after the scope check. */
	private async loadItem(bookingItemId: number): Promise<ProcessingItem> {
		const [row] = await db
			.select({
				bookingItemId: bookingItems.id,
				status: bookingItems.status,
				feeCentavos: bookingItems.feeCentavos,
				bookingId: bookings.id,
				referenceNumber: bookings.referenceNumber,
				bookingStatus: bookings.status,
				kind: bookings.kind,
				totalCentavos: bookings.totalCentavos,
				serviceId: services.id,
				serviceName: services.name,
				requiresApproval: services.requiresApproval,
				locationId: locations.id,
				locationName: locations.name,
				startsAt: scheduleSlots.startsAt,
				endsAt: scheduleSlots.endsAt,
				clientId: users.id,
				clientName: users.name,
				clientEmail: users.email,
				clientMobile: users.mobile,
				clientBirthDate: users.birthDate,
				clientGender: users.gender,
				clientNationality: users.nationality,
			})
			.from(bookingItems)
			.innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
			.innerJoin(users, eq(users.id, bookings.clientId))
			.innerJoin(services, eq(services.id, bookingItems.serviceId))
			.innerJoin(locations, eq(locations.id, bookingItems.locationId))
			.innerJoin(scheduleSlots, eq(scheduleSlots.id, bookingItems.scheduleSlotId))
			.where(eq(bookingItems.id, bookingItemId))
			.limit(1)
		if (!row) throw itemNotFound()

		const history = await db
			.select({
				id: assessments.id,
				outcome: assessments.outcome,
				notes: assessments.notes,
				corrections: assessments.corrections,
				staffId: assessments.staffId,
				staffName: users.name,
				createdAt: assessments.createdAt,
			})
			.from(assessments)
			.innerJoin(users, eq(users.id, assessments.staffId))
			.where(eq(assessments.bookingItemId, bookingItemId))
			.orderBy(desc(assessments.createdAt), desc(assessments.id))

		return {
			bookingItemId: row.bookingItemId,
			status: row.status,
			booking: {
				id: row.bookingId,
				referenceNumber: row.referenceNumber,
				status: row.bookingStatus,
				kind: row.kind,
				totalCentavos: row.totalCentavos,
			},
			paymentStatus: paymentStatusOf(row.bookingStatus),
			service: {
				id: row.serviceId,
				name: row.serviceName,
				requiresApproval: row.requiresApproval,
			},
			location: { id: row.locationId, name: row.locationName },
			startsAt: row.startsAt,
			endsAt: row.endsAt,
			feeCentavos: row.feeCentavos,
			client: {
				id: row.clientId,
				name: row.clientName,
				email: row.clientEmail,
				mobile: row.clientMobile,
				birthDate: row.clientBirthDate,
				gender: row.clientGender,
				nationality: row.clientNationality,
			},
			// `form_submissions` arrives with the forms epic; until then there is nothing to show.
			formAnswers: {},
			assessments: history,
		}
	}

	/** Recorded outside any transaction, so the denial is kept when the request fails. */
	private async recordDenial(
		staffId: string,
		action: string,
		targetType: "booking" | "booking_item",
		targetId: number,
		reason: "outside_scope" | "no_location" | "payment_required"
	): Promise<void> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_PROCESSING,
			action,
			outcome: "denied",
			actorId: staffId,
			targetType,
			targetId: String(targetId),
			reason,
		})
	}
}

function requireActor(actorId: string | null): string {
	if (!actorId) {
		throw new ORPCError("UNAUTHORIZED", { message: "Sign in to use processing" })
	}
	return actorId
}
