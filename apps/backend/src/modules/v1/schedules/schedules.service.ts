import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, gte, isNotNull, lt } from "drizzle-orm"

import type {
	BlockScheduleDateRequest,
	BulkUpdateCapacityRequest,
	BulkUpdateCapacityResponse,
	GenerateSlotsInput,
	GenerateSlotsResponse,
	ListSlotsRequest,
	ScheduleSlot,
	SetSlotDisabledRequest,
	SlotAvailability,
	UpdateSlotCapacityRequest,
} from "@repo/contracts"
import { bookingItems, bookings, locations, scheduleSlots, services } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { denyOutsideScope } from "@/common/scope/scope-denial"
import {
	inScope,
	NATIONWIDE_SCOPE,
	scopeCondition,
	type ResolvedScope,
} from "@/common/scope/scope-match"

import {
	eachDate,
	manilaDateOf,
	manilaDateTimeToUtc,
	manilaMonthRange,
	weekdayOf,
} from "./manila-time"

const AUDIT_DOMAIN_SCHEDULES = "schedules"

/** The most slots one generate request may create. */
export const MAX_SLOTS_PER_REQUEST = 2000

/** Rows per INSERT, to stay well under PostgreSQL's parameter limit. */
const INSERT_CHUNK_SIZE = 500

type SlotRow = typeof scheduleSlots.$inferSelect

/** The start and end of every slot a generate request asks for, in UTC. */
export function slotTimesFor(
	input: Pick<GenerateSlotsInput, "startDate" | "endDate" | "weekdays" | "windows">
): { startsAt: Date; endsAt: Date }[] {
	const weekdays = new Set(input.weekdays)
	const times: { startsAt: Date; endsAt: Date }[] = []
	for (const date of eachDate(input.startDate, input.endDate)) {
		if (!weekdays.has(weekdayOf(date))) continue
		for (const window of input.windows) {
			times.push({
				startsAt: manilaDateTimeToUtc(date, window.startTime),
				endsAt: manilaDateTimeToUtc(date, window.endTime),
			})
		}
	}
	return times
}

/**
 * What a client sees for one slot. A slot cannot be booked when it is full,
 * disabled, or has already started.
 */
export function slotAvailability(slot: SlotRow, now: Date): SlotAvailability {
	const remainingCapacity = Math.max(0, slot.capacity - slot.bookedCount)
	return {
		id: slot.id,
		startsAt: slot.startsAt,
		endsAt: slot.endsAt,
		remainingCapacity,
		isAvailable:
			!slot.isDisabled && remainingCapacity > 0 && slot.startsAt.getTime() > now.getTime(),
	}
}

function bookingCount(count: number): string {
	return count === 1 ? "1 booking" : `${count} bookings`
}

function shiftDate(date: string, days: number): string {
	const value = new Date(`${date  }T00:00:00.000Z`)
	value.setUTCDate(value.getUTCDate() + days)
	return value.toISOString().slice(0, 10)
}

function dateRange(anchorDate: string, period: "day" | "week" | "month") {
	let startDate = anchorDate
	let endDate = shiftDate(anchorDate, 1)
	if (period === "week") {
		const mondayOffset = (weekdayOf(anchorDate) + 6) % 7
		startDate = shiftDate(anchorDate, -mondayOffset)
		endDate = shiftDate(startDate, 7)
	} else if (period === "month") {
		const [year = 0, month = 1] = anchorDate.split("-").map(Number)
		startDate = `${anchorDate.slice(0, 7)}-01`
		const nextYear = month === 12 ? year + 1 : year
		const nextMonth = month === 12 ? 1 : month + 1
		endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`
	}
	return { startDate, endDate, start: manilaDateTimeToUtc(startDate, "00:00"), end: manilaDateTimeToUtc(endDate, "00:00") }
}

/**
 * Schedule Slots (SCH-1): capacity for one Service at one Location on one date
 * and time window.
 *
 * This service creates slots and edits `capacity`, `is_disabled` and the
 * date-block reason. It never
 * writes `booked_count`: only `BookingService` changes it, with a row lock
 * (DOMAIN-MODEL.md section 6). Every change is audited in the same transaction.
 */
@Injectable()
export class SchedulesService {
	constructor(private readonly auditService: AuditService) {}

	/**
	 * Every slot for a service at a location in one Manila month, disabled ones
	 * included. ADM-2: empty when that service or location is outside the
	 * caller's Scope.
	 */
	async listSlots(
		input: ListSlotsRequest,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ScheduleSlot[]> {
		const { start, end } = manilaMonthRange(input.month)
		const inMonth = and(
			eq(scheduleSlots.serviceId, input.serviceId),
			eq(scheduleSlots.locationId, input.locationId),
			gte(scheduleSlots.startsAt, start),
			lt(scheduleSlots.startsAt, end)
		)

		// No limit: the plain query, without the join the Scope check needs.
		if (scope.nationwide) {
			return db.select().from(scheduleSlots).where(inMonth).orderBy(asc(scheduleSlots.startsAt))
		}

		const rows = await db
			.select({ slot: scheduleSlots })
			.from(scheduleSlots)
			.innerJoin(services, eq(scheduleSlots.serviceId, services.id))
			.where(
				and(
					inMonth,
					scopeCondition(scope, {
						serviceCategoryId: services.serviceCategoryId,
						locationId: scheduleSlots.locationId,
					})
				)
			)
			.orderBy(asc(scheduleSlots.startsAt))
		return rows.map(({ slot }) => slot)
	}

	/**
	 * Remaining capacity per slot for a signed-in client choosing a date.
	 * A disabled service or location has nothing to book, so it returns no slots.
	 */
	async listAvailability(
		input: ListSlotsRequest,
		now: Date = new Date()
	): Promise<SlotAvailability[]> {
		const { start, end } = manilaMonthRange(input.month)
		const rows = await db
			.select({ slot: scheduleSlots })
			.from(scheduleSlots)
			.innerJoin(services, eq(scheduleSlots.serviceId, services.id))
			.innerJoin(locations, eq(scheduleSlots.locationId, locations.id))
			.where(
				and(
					eq(scheduleSlots.serviceId, input.serviceId),
					eq(scheduleSlots.locationId, input.locationId),
					eq(services.isActive, true),
					eq(locations.isActive, true),
					gte(scheduleSlots.startsAt, start),
					lt(scheduleSlots.startsAt, end)
				)
			)
			.orderBy(asc(scheduleSlots.startsAt))
		return rows.map(({ slot }) => slotAvailability(slot, now))
	}

	/**
	 * Create one slot per date and time window. A slot that already exists for
	 * the same service, location and start time is skipped, so the same request
	 * can be sent twice without creating duplicates.
	 */
	async generateSlots(
		input: GenerateSlotsInput,
		actorId: string | null,
		now: Date = new Date(),
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<GenerateSlotsResponse> {
		if (input.startDate < manilaDateOf(now)) {
			throw new ORPCError("BAD_REQUEST", { message: "Start date cannot be in the past" })
		}

		const times = slotTimesFor(input)
		if (times.length === 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "No date in that range falls on the chosen days of the week",
			})
		}
		if (times.length > MAX_SLOTS_PER_REQUEST) {
			throw new ORPCError("BAD_REQUEST", {
				message: `That would create ${times.length} slots. Create ${MAX_SLOTS_PER_REQUEST} or fewer at a time by shortening the date range.`,
			})
		}

		return db.transaction(async tx => {
			const [service] = await tx
				.select({
					id: services.id,
					name: services.name,
					isActive: services.isActive,
					serviceCategoryId: services.serviceCategoryId,
				})
				.from(services)
				.where(eq(services.id, input.serviceId))
			if (!service) {
				throw new ORPCError("NOT_FOUND", { message: `Service "${input.serviceId}" was not found` })
			}
			if (!inScope(scope, { serviceCategoryId: service.serviceCategoryId })) {
				await denyOutsideScope(
					this.auditService,
					actorId,
					{
						type: "service",
						id: service.id,
						notFoundMessage: `Service "${input.serviceId}" was not found`,
					},
					{ serviceCategoryId: service.serviceCategoryId }
				)
			}
			if (!service.isActive) {
				throw new ORPCError("CONFLICT", {
					message: `Service "${service.name}" is disabled. Enable it before adding slots.`,
				})
			}

			const [location] = await tx
				.select({ id: locations.id, name: locations.name, isActive: locations.isActive })
				.from(locations)
				.where(eq(locations.id, input.locationId))
			if (!location) {
				throw new ORPCError("NOT_FOUND", {
					message: `Location "${input.locationId}" was not found`,
				})
			}
			if (
				!inScope(scope, { serviceCategoryId: service.serviceCategoryId, locationId: location.id })
			) {
				await denyOutsideScope(
					this.auditService,
					actorId,
					{
						type: "location",
						id: location.id,
						notFoundMessage: `Location "${input.locationId}" was not found`,
					},
					{ serviceCategoryId: service.serviceCategoryId, locationId: location.id }
				)
			}
			if (!location.isActive) {
				throw new ORPCError("CONFLICT", {
					message: `Location "${location.name}" is disabled. Enable it before adding slots.`,
				})
			}

			let createdCount = 0
			for (let index = 0; index < times.length; index += INSERT_CHUNK_SIZE) {
				const created = await tx
					.insert(scheduleSlots)
					.values(
						times.slice(index, index + INSERT_CHUNK_SIZE).map(({ startsAt, endsAt }) => ({
							serviceId: input.serviceId,
							locationId: input.locationId,
							startsAt,
							endsAt,
							capacity: input.capacity,
						}))
					)
					.onConflictDoNothing({
						target: [scheduleSlots.serviceId, scheduleSlots.locationId, scheduleSlots.startsAt],
					})
					.returning({ id: scheduleSlots.id })
				createdCount += created.length
			}
			const skippedCount = times.length - createdCount

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SCHEDULES,
					action: "schedule.slots.generate",
					actorId,
					targetType: "schedule_slot",
					targetId: null,
					oldValue: null,
					newValue: {
						serviceId: input.serviceId,
						locationId: input.locationId,
						startDate: input.startDate,
						endDate: input.endDate,
						weekdays: input.weekdays,
						windows: input.windows,
						capacity: input.capacity,
						createdCount,
						skippedCount,
					},
				},
				tx
			)
			return { createdCount, skippedCount }
		})
	}

	/** Bulk capacity edit; unsafe reductions are reported and left unchanged. */
	async bulkUpdateCapacity(input: BulkUpdateCapacityRequest, actorId: string | null, scope: ResolvedScope = NATIONWIDE_SCOPE): Promise<BulkUpdateCapacityResponse> {
		const range = dateRange(input.anchorDate, input.period)
		return db.transaction(async tx => {
			const slots = await tx.select().from(scheduleSlots).where(and(
				eq(scheduleSlots.serviceId, input.serviceId), eq(scheduleSlots.locationId, input.locationId),
				gte(scheduleSlots.startsAt, range.start), lt(scheduleSlots.startsAt, range.end)
			)).orderBy(asc(scheduleSlots.id)).for("update")
			if (slots.length > 0) await this.requireSlotInScope(tx, slots[0]!, actorId, scope)
			const skipped: BulkUpdateCapacityResponse["skipped"] = []
			let updatedCount = 0
			for (const slot of slots) {
				if (slot.bookedCount > input.capacity) {
					skipped.push({ id: slot.id, startsAt: slot.startsAt, bookedCount: slot.bookedCount, capacity: slot.capacity })
					continue
				}
				await tx.update(scheduleSlots).set({ capacity: input.capacity, updatedAt: new Date() }).where(eq(scheduleSlots.id, slot.id))
				updatedCount++
			}
			await this.auditService.record({ domain: AUDIT_DOMAIN_SCHEDULES, action: "schedule.slots.capacity.bulk_update", actorId, targetType: "schedule_slot", targetId: null, oldValue: null,
				newValue: { serviceId: input.serviceId, locationId: input.locationId, period: input.period, startDate: range.startDate, endDate: shiftDate(range.endDate, -1), capacity: input.capacity, selectedCount: slots.length, updatedCount, skippedCount: skipped.length } }, tx)
			return { selectedCount: slots.length, updatedCount, skipped }
		})
	}

	async blockDate(input: BlockScheduleDateRequest, actorId: string | null, scope: ResolvedScope = NATIONWIDE_SCOPE) {
		const range = dateRange(input.date, "day")
		return db.transaction(async tx => {
			const slots = await tx.select().from(scheduleSlots).where(and(
				eq(scheduleSlots.serviceId, input.serviceId), eq(scheduleSlots.locationId, input.locationId),
				gte(scheduleSlots.startsAt, range.start), lt(scheduleSlots.startsAt, range.end)
			)).orderBy(asc(scheduleSlots.id)).for("update")
			if (slots.length > 0) await this.requireSlotInScope(tx, slots[0]!, actorId, scope)
			const paidBookings = new Map<string, Date>()
			for (const slot of slots) {
				const paid = await tx.select({ referenceNumber: bookings.referenceNumber, startsAt: scheduleSlots.startsAt })
					.from(bookingItems).innerJoin(bookings, eq(bookingItems.bookingId, bookings.id))
					.innerJoin(scheduleSlots, eq(bookingItems.scheduleSlotId, scheduleSlots.id))
					.where(and(eq(bookingItems.scheduleSlotId, slot.id), eq(bookings.status, "paid")))
				for (const booking of paid) paidBookings.set(booking.referenceNumber, booking.startsAt)
				// Preserve a one-off manual disable across a later date unblock. A
				// non-null reason marks slots disabled by this date-level action.
				if (!slot.isDisabled || slot.disabledReason !== null) {
					await tx.update(scheduleSlots).set({ isDisabled: true, disabledReason: input.reason, updatedAt: new Date() }).where(eq(scheduleSlots.id, slot.id))
				}
			}
			const affected = [...paidBookings].map(([referenceNumber, startsAt]) => ({ referenceNumber, startsAt }))
			await this.auditService.record({ domain: AUDIT_DOMAIN_SCHEDULES, action: "schedule.date.block", actorId, targetType: "schedule_date", targetId: `${String(input.serviceId)  }:${  String(input.locationId)  }:${  input.date}`,
				oldValue: null, newValue: { serviceId: input.serviceId, locationId: input.locationId, date: input.date, reason: input.reason, disabledCount: slots.length, paidBookingCount: affected.length } }, tx)
			return { disabledCount: slots.length, paidBookings: affected }
		})
	}

	async unblockDate(input: { serviceId: number; locationId: number; date: string }, actorId: string | null, scope: ResolvedScope = NATIONWIDE_SCOPE) {
		const range = dateRange(input.date, "day")
		return db.transaction(async tx => {
			const slots = await tx.select().from(scheduleSlots).where(and(
				eq(scheduleSlots.serviceId, input.serviceId), eq(scheduleSlots.locationId, input.locationId),
				gte(scheduleSlots.startsAt, range.start), lt(scheduleSlots.startsAt, range.end), isNotNull(scheduleSlots.disabledReason)
			)).orderBy(asc(scheduleSlots.id)).for("update")
			if (slots.length > 0) await this.requireSlotInScope(tx, slots[0]!, actorId, scope)
			for (const slot of slots) await tx.update(scheduleSlots).set({ isDisabled: false, disabledReason: null, updatedAt: new Date() }).where(eq(scheduleSlots.id, slot.id))
			await this.auditService.record({ domain: AUDIT_DOMAIN_SCHEDULES, action: "schedule.date.unblock", actorId, targetType: "schedule_date", targetId: `${String(input.serviceId)  }:${  String(input.locationId)  }:${  input.date}`,
				oldValue: null, newValue: { serviceId: input.serviceId, locationId: input.locationId, date: input.date, enabledCount: slots.length } }, tx)
			return { enabledCount: slots.length }
		})
	}

	/** Change capacity. It may not go below the bookings already made. */
	async updateSlotCapacity(
		input: UpdateSlotCapacityRequest,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ScheduleSlot> {
		return db.transaction(async tx => {
			// Locked so a booking cannot take a place between this check and the update.
			const [current] = await tx
				.select()
				.from(scheduleSlots)
				.where(eq(scheduleSlots.id, input.id))
				.for("update")
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Schedule slot "${input.id}" was not found` })
			}
			await this.requireSlotInScope(tx, current, actorId, scope)
			if (input.capacity < current.bookedCount) {
				throw new ORPCError("CONFLICT", {
					message: `Capacity cannot be lower than the ${bookingCount(current.bookedCount)} already made for this slot.`,
				})
			}

			const [updated] = await tx
				.update(scheduleSlots)
				.set({ capacity: input.capacity, updatedAt: new Date() })
				.where(eq(scheduleSlots.id, current.id))
				.returning()
			if (!updated) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Schedule slot capacity could not be updated",
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SCHEDULES,
					action: "schedule.slot.capacity.update",
					actorId,
					targetType: "schedule_slot",
					targetId: String(current.id),
					oldValue: this.auditValue(current),
					newValue: this.auditValue(updated),
				},
				tx
			)
			return updated
		})
	}

	/** Disable or re-enable a slot. Existing bookings are not touched. */
	async setSlotDisabled(
		input: SetSlotDisabledRequest,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ScheduleSlot> {
		return db.transaction(async tx => {
			const [current] = await tx.select().from(scheduleSlots).where(eq(scheduleSlots.id, input.id))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Schedule slot "${input.id}" was not found` })
			}
			await this.requireSlotInScope(tx, current, actorId, scope)

			const [updated] = await tx
				.update(scheduleSlots)
				.set({ isDisabled: input.isDisabled, ...(input.isDisabled ? {} : { disabledReason: null }), updatedAt: new Date() })
				.where(eq(scheduleSlots.id, current.id))
				.returning()
			if (!updated) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Schedule slot status could not be updated",
				})
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SCHEDULES,
					action: input.isDisabled ? "schedule.slot.disable" : "schedule.slot.enable",
					actorId,
					targetType: "schedule_slot",
					targetId: String(current.id),
					oldValue: this.auditValue(current),
					newValue: this.auditValue(updated),
				},
				tx
			)
			return updated
		})
	}

	/** Delete a slot that nobody has booked. A booked slot is disabled instead. */
	async deleteSlot(
		id: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<{ success: true; id: number }> {
		return db.transaction(async tx => {
			// Locked so a booking cannot land on the slot while it is being deleted.
			const [current] = await tx
				.select()
				.from(scheduleSlots)
				.where(eq(scheduleSlots.id, id))
				.for("update")
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Schedule slot "${id}" was not found` })
			}
			await this.requireSlotInScope(tx, current, actorId, scope)
			if (current.bookedCount > 0) {
				throw new ORPCError("CONFLICT", {
					message: `This slot has ${bookingCount(current.bookedCount)} and cannot be deleted. Disable it instead.`,
				})
			}

			await tx.delete(scheduleSlots).where(eq(scheduleSlots.id, current.id))

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SCHEDULES,
					action: "schedule.slot.delete",
					actorId,
					targetType: "schedule_slot",
					targetId: String(current.id),
					oldValue: this.auditValue(current),
					newValue: null,
				},
				tx
			)
			return { success: true as const, id: current.id }
		})
	}

	/** ADM-2: a slot outside the caller's Scope answers like a missing one. */
	private async requireSlotInScope(
		tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
		slot: SlotRow,
		actorId: string | null,
		scope: ResolvedScope
	): Promise<void> {
		if (scope.nationwide) return
		const [service] = await tx
			.select({ serviceCategoryId: services.serviceCategoryId })
			.from(services)
			.where(eq(services.id, slot.serviceId))
		// The foreign key means the service exists; the guard keeps the type honest.
		const record = service
			? { serviceCategoryId: service.serviceCategoryId, locationId: slot.locationId }
			: { locationId: slot.locationId }
		if (inScope(scope, record)) return
		await denyOutsideScope(
			this.auditService,
			actorId,
			{
				type: "schedule_slot",
				id: slot.id,
				notFoundMessage: `Schedule slot "${slot.id}" was not found`,
			},
			record
		)
	}

	private auditValue(slot: SlotRow) {
		return {
			id: slot.id,
			serviceId: slot.serviceId,
			locationId: slot.locationId,
			startsAt: slot.startsAt.toISOString(),
			endsAt: slot.endsAt.toISOString(),
			capacity: slot.capacity,
			bookedCount: slot.bookedCount,
			isDisabled: slot.isDisabled,
		}
	}
}
