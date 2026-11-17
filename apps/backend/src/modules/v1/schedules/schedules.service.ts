import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq, gte, lt } from "drizzle-orm"

import type {
	GenerateSlotsInput,
	GenerateSlotsResponse,
	ListSlotsRequest,
	ScheduleSlot,
	SetSlotDisabledRequest,
	SlotAvailability,
	UpdateSlotCapacityRequest,
} from "@repo/contracts"
import { locations, scheduleSlots, services } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

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

/**
 * Schedule Slots (SCH-1): capacity for one Service at one Location on one date
 * and time window.
 *
 * This service creates slots and edits `capacity` and `is_disabled`. It never
 * writes `booked_count`: only `BookingService` changes it, with a row lock
 * (DOMAIN-MODEL.md section 6). Every change is audited in the same transaction.
 */
@Injectable()
export class SchedulesService {
	constructor(private readonly auditService: AuditService) {}

	/** Every slot for a service at a location in one Manila month, disabled ones included. */
	async listSlots(input: ListSlotsRequest): Promise<ScheduleSlot[]> {
		const { start, end } = manilaMonthRange(input.month)
		return db
			.select()
			.from(scheduleSlots)
			.where(
				and(
					eq(scheduleSlots.serviceId, input.serviceId),
					eq(scheduleSlots.locationId, input.locationId),
					gte(scheduleSlots.startsAt, start),
					lt(scheduleSlots.startsAt, end)
				)
			)
			.orderBy(asc(scheduleSlots.startsAt))
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
		now: Date = new Date()
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
				.select({ id: services.id, name: services.name, isActive: services.isActive })
				.from(services)
				.where(eq(services.id, input.serviceId))
			if (!service) {
				throw new ORPCError("NOT_FOUND", { message: `Service "${input.serviceId}" was not found` })
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

	/** Change capacity. It may not go below the bookings already made. */
	async updateSlotCapacity(
		input: UpdateSlotCapacityRequest,
		actorId: string | null
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
		actorId: string | null
	): Promise<ScheduleSlot> {
		return db.transaction(async tx => {
			const [current] = await tx.select().from(scheduleSlots).where(eq(scheduleSlots.id, input.id))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Schedule slot "${input.id}" was not found` })
			}

			const [updated] = await tx
				.update(scheduleSlots)
				.set({ isDisabled: input.isDisabled, updatedAt: new Date() })
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
	async deleteSlot(id: number, actorId: string | null): Promise<{ success: true; id: number }> {
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
