import { z } from "zod"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

const ServiceIdSchema = z.number().int().positive()
const LocationIdSchema = z.number().int().positive()
const SlotIdSchema = z.number().int().positive()

/** How many clients one slot can take. */
const CapacitySchema = z
	.number()
	.int("Capacity must be a whole number")
	.min(1, "Capacity must be at least 1")
	.max(10_000, "Capacity must be 10,000 or fewer")

/** The longest date range one generate request may cover. */
export const MAX_GENERATE_DAYS = 366

const MS_PER_DAY = 86_400_000

/** Milliseconds at UTC midnight for a "YYYY-MM-DD" date, or null if it is not a real date. */
function businessDateMs(value: string): number | null {
	const [year, month, day] = value.split("-").map(Number)
	if (year === undefined || month === undefined || day === undefined) return null
	const ms = Date.UTC(year, month - 1, day)
	const date = new Date(ms)
	const isReal =
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	return isReal ? ms : null
}

/** A calendar date in Asia/Manila, written "YYYY-MM-DD". */
export const BusinessDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date format YYYY-MM-DD")
	.refine(value => businessDateMs(value) !== null, "That date does not exist")

/** A calendar month in Asia/Manila, written "YYYY-MM". */
export const BusinessMonthSchema = z
	.string()
	.regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the month format YYYY-MM")

/** A time of day in Asia/Manila on the 24-hour clock, written "HH:mm". */
const TimeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the time format HH:mm")

/** One daily time window, for example 08:00 to 10:00. */
export const TimeWindowSchema = z
	.object({
		startTime: TimeOfDaySchema,
		endTime: TimeOfDaySchema,
	})
	.refine(({ startTime, endTime }) => endTime > startTime, "End time must be after start time")

/** Day of the week: 0 is Sunday and 6 is Saturday, as in JavaScript's `getDay()`. */
const WeekdaySchema = z.number().int().min(0).max(6)

export const ScheduleSlotSchema = z.object({
	id: SlotIdSchema,
	serviceId: ServiceIdSchema,
	locationId: LocationIdSchema,
	startsAt: dateField,
	endsAt: dateField,
	capacity: z.number().int().min(0),
	bookedCount: z.number().int().min(0),
	isDisabled: z.boolean(),
	/** SCH-2: set when a date block disabled the slot; null when disabled by hand or open. */
	disabledReason: z.string().nullable().optional(),
	createdAt: dateField,
	updatedAt: dateField,
})

/**
 * Create one slot per date and time window.
 *
 * Dates and times are Asia/Manila. Slots that already exist for the same
 * service, location and start time are skipped, so a request can be repeated.
 */
export const GenerateSlotsSchema = z
	.object({
		serviceId: ServiceIdSchema,
		locationId: LocationIdSchema,
		startDate: BusinessDateSchema,
		endDate: BusinessDateSchema,
		weekdays: z
			.array(WeekdaySchema)
			.min(1, "Choose at least one day of the week")
			.max(7)
			.refine(days => new Set(days).size === days.length, "Each day can be chosen only once"),
		windows: z
			.array(TimeWindowSchema)
			.min(1, "Add at least one time window")
			.max(24, "Add 24 time windows or fewer")
			.refine(windows => {
				const sorted = [...windows].sort((a, b) => a.startTime.localeCompare(b.startTime))
				return sorted.every((window, index) => {
					const previous = sorted[index - 1]
					return previous === undefined || window.startTime >= previous.endTime
				})
			}, "Time windows must not overlap"),
		capacity: CapacitySchema,
	})
	.superRefine(({ startDate, endDate }, context) => {
		const start = businessDateMs(startDate)
		const end = businessDateMs(endDate)
		if (start === null || end === null) return
		if (end < start) {
			context.addIssue({
				code: "custom",
				path: ["endDate"],
				message: "End date must be on or after the start date",
			})
			return
		}
		if ((end - start) / MS_PER_DAY + 1 > MAX_GENERATE_DAYS) {
			context.addIssue({
				code: "custom",
				path: ["endDate"],
				message: `The date range must be ${MAX_GENERATE_DAYS} days or fewer`,
			})
		}
	})

export const GenerateSlotsResponseSchema = z.object({
	/** Slots created by this request. */
	createdCount: z.number().int().min(0),
	/** Slots left alone because one already existed at that start time. */
	skippedCount: z.number().int().min(0),
})

/** Query values arrive as text ("?serviceId=7"), so the ids are converted to numbers. */
export const ListSlotsRequestSchema = z.object({
	serviceId: z.coerce.number().int().positive(),
	locationId: z.coerce.number().int().positive(),
	month: BusinessMonthSchema,
})

/** Path params arrive as text ("/schedules/slots/7"), so the id is converted to a number. */
export const SlotIdParamSchema = z.object({ id: z.coerce.number().int().positive() })

export const UpdateSlotCapacityRequestSchema = SlotIdParamSchema.extend({
	capacity: CapacitySchema,
})

/** SCH-2: bulk edit one Manila calendar day, Monday-to-Sunday week, or calendar month. */
export const BulkUpdateCapacityRequestSchema = z.object({
	serviceId: ServiceIdSchema,
	locationId: LocationIdSchema,
	period: z.enum(["day", "week", "month"]),
	anchorDate: BusinessDateSchema,
	capacity: CapacitySchema,
})

export const BulkUpdateCapacityResponseSchema = z.object({
	/** Slots in the chosen period. */
	selectedCount: z.number().int().min(0),
	/** Slots that now have the new capacity. */
	updatedCount: z.number().int().min(0),
	/** Slots left unchanged because they already have more bookings than the new capacity. */
	skipped: z.array(
		z.object({
			id: SlotIdSchema,
			startsAt: dateField,
			bookedCount: z.number().int().min(0),
			capacity: z.number().int().min(0),
		})
	),
})

/** SCH-2: disable every slot of a service at a location on one Manila date. */
export const BlockScheduleDateRequestSchema = z.object({
	serviceId: ServiceIdSchema,
	locationId: LocationIdSchema,
	date: BusinessDateSchema,
	reason: z.string().trim().min(1, "Enter a reason").max(500, "Use 500 characters or fewer"),
})

export const BlockScheduleDateResponseSchema = z.object({
	/** Slots this request disabled. Slots already disabled by hand are not counted. */
	disabledCount: z.number().int().min(0),
	/** Paid Bookings on that date, listed for follow-up; none is cancelled. */
	paidBookings: z.array(
		z.object({
			referenceNumber: z.string(),
			startsAt: dateField,
		})
	),
})

/** SCH-2: re-enable the slots a date block disabled on one Manila date. */
export const UnblockScheduleDateRequestSchema = z.object({
	serviceId: ServiceIdSchema,
	locationId: LocationIdSchema,
	date: BusinessDateSchema,
})

export const UnblockScheduleDateResponseSchema = z.object({
	enabledCount: z.number().int().min(0),
})

export const SetSlotDisabledRequestSchema = SlotIdParamSchema.extend({
	isDisabled: z.boolean(),
})

export const DeleteSlotResponseSchema = z.object({
	success: z.boolean(),
	id: SlotIdSchema,
})

/** What a client sees for one slot when choosing a date and time. */
export const SlotAvailabilitySchema = z.object({
	id: SlotIdSchema,
	startsAt: dateField,
	endsAt: dateField,
	/** Places left; never below zero. */
	remainingCapacity: z.number().int().min(0),
	/** False when the slot is full, disabled, or has already started. */
	isAvailable: z.boolean(),
})

export type TimeWindow = z.infer<typeof TimeWindowSchema>
export type ScheduleSlot = z.infer<typeof ScheduleSlotSchema>
export type GenerateSlotsInput = z.infer<typeof GenerateSlotsSchema>
export type GenerateSlotsResponse = z.infer<typeof GenerateSlotsResponseSchema>
export type ListSlotsRequest = z.infer<typeof ListSlotsRequestSchema>
export type UpdateSlotCapacityRequest = z.infer<typeof UpdateSlotCapacityRequestSchema>
export type BulkUpdateCapacityRequest = z.infer<typeof BulkUpdateCapacityRequestSchema>
export type BulkUpdateCapacityResponse = z.infer<typeof BulkUpdateCapacityResponseSchema>
export type BlockScheduleDateRequest = z.infer<typeof BlockScheduleDateRequestSchema>
export type BlockScheduleDateResponse = z.infer<typeof BlockScheduleDateResponseSchema>
export type UnblockScheduleDateRequest = z.infer<typeof UnblockScheduleDateRequestSchema>
export type UnblockScheduleDateResponse = z.infer<typeof UnblockScheduleDateResponseSchema>
export type SetSlotDisabledRequest = z.infer<typeof SetSlotDisabledRequestSchema>
export type SlotAvailability = z.infer<typeof SlotAvailabilitySchema>
