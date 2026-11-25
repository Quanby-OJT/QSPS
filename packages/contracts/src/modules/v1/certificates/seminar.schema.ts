import { z } from "zod"

import { BookingItemStatusSchema, ReferenceNumberSchema } from "../bookings/bookings.schema.js"
import { BusinessDateSchema } from "../schedules/schedules.schema.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/**
 * Most attendees one attendance or issue request may name (CRT-6). A seminar
 * session is a normal Schedule Slot, and slot capacity is far below this.
 */
export const MAX_SEMINAR_ATTENDEES_PER_REQUEST = 500

/** The seminar sessions of one Manila date. Today when no date is given. */
export const SeminarSessionsRequestSchema = z.object({
	date: BusinessDateSchema.optional(),
})

/** One seminar session: a Schedule Slot of a Service that issues the Food Safety Training Certificate. */
export const SeminarSessionSchema = z.object({
	scheduleSlotId: z.number().int().positive(),
	serviceId: z.number().int().positive(),
	serviceName: z.string(),
	locationId: z.number().int().positive(),
	locationName: z.string(),
	startsAt: dateField,
	endsAt: dateField,
	/** Seats in the slot and how many are taken: the same numbers as any Schedule Slot. */
	capacity: z.number().int().min(0),
	bookedCount: z.number().int().min(0),
	/** Attendees whose Booking is paid. */
	paidCount: z.number().int().min(0),
	/** Marked present: checked in, in assessment, cleared or issued. */
	presentCount: z.number().int().min(0),
	/** Marked absent (`no_show`). */
	absentCount: z.number().int().min(0),
	/** Attendees who already hold their certificate. */
	issuedCount: z.number().int().min(0),
})

export const SeminarSessionsSchema = z.object({
	date: BusinessDateSchema,
	sessions: z.array(SeminarSessionSchema),
})

export const SeminarSessionParamSchema = z.object({
	scheduleSlotId: z.coerce.number().int().positive(),
})

/** One client booked into a session. */
export const SeminarAttendeeSchema = z.object({
	bookingItemId: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	clientName: z.string(),
	status: BookingItemStatusSchema,
	/** Annex B: paid when the Booking is `paid` or `completed`. Only paid attendees can be marked. */
	paymentStatus: z.enum(["paid", "unpaid"]),
	/** The Food Safety Training Certificate, once issued. */
	documentNumber: z.string().nullable(),
})

export const SeminarRosterSchema = z.object({
	session: SeminarSessionSchema,
	attendees: z.array(SeminarAttendeeSchema),
})

const bookingItemIds = z.array(z.number().int().positive()).max(MAX_SEMINAR_ATTENDEES_PER_REQUEST)

/** What happened to one attendee when attendance was marked. */
export const SEMINAR_ATTENDANCE_OUTCOMES = [
	"present",
	"absent",
	"unchanged",
	"refused",
	"not_found",
] as const

/** What happened to one attendee when certificates were issued. */
export const SEMINAR_ISSUE_OUTCOMES = ["issued", "already_issued", "refused", "not_found"] as const

/**
 * Mark attendance for one session (CRT-6). Present attendees are cleared,
 * absent ones become `no_show`. Each attendee is handled on its own: one that
 * cannot be marked never blocks the others.
 */
export const SeminarAttendanceSchema = SeminarSessionParamSchema.extend({
	present: bookingItemIds.default([]),
	absent: bookingItemIds.default([]),
}).superRefine((value, context) => {
	if (value.present.length + value.absent.length === 0) {
		context.addIssue({
			code: "custom",
			message: "Choose at least one attendee to mark",
			path: ["present"],
		})
		return
	}
	const present = new Set(value.present)
	if (value.absent.some(id => present.has(id))) {
		context.addIssue({
			code: "custom",
			message: "An attendee cannot be marked both present and absent",
			path: ["absent"],
		})
	}
})

export const SeminarAttendanceResultSchema = z.object({
	results: z.array(
		z.object({
			bookingItemId: z.number().int().positive(),
			outcome: z.enum(SEMINAR_ATTENDANCE_OUTCOMES),
			/** Why, in words staff can act on. */
			message: z.string(),
		})
	),
})

/**
 * Issue the Food Safety Training Certificate to the attendees of one session
 * (CRT-6). Without `bookingItemIds`, every attendee marked present is
 * included, and one who already holds a certificate is reported as such.
 */
export const SeminarIssueSchema = SeminarSessionParamSchema.extend({
	bookingItemIds: bookingItemIds.min(1, "Choose at least one attendee").optional(),
})

export const SeminarIssueResultSchema = z.object({
	results: z.array(
		z.object({
			bookingItemId: z.number().int().positive(),
			outcome: z.enum(SEMINAR_ISSUE_OUTCOMES),
			message: z.string(),
			/** The certificate, when `issued` or `already_issued`. */
			documentNumber: z.string().nullable(),
		})
	),
})

export type SeminarSessionsRequest = z.infer<typeof SeminarSessionsRequestSchema>
export type SeminarSession = z.infer<typeof SeminarSessionSchema>
export type SeminarSessions = z.infer<typeof SeminarSessionsSchema>
export type SeminarSessionParam = z.infer<typeof SeminarSessionParamSchema>
export type SeminarAttendee = z.infer<typeof SeminarAttendeeSchema>
export type SeminarRoster = z.infer<typeof SeminarRosterSchema>
export type SeminarAttendanceInput = z.infer<typeof SeminarAttendanceSchema>
export type SeminarAttendanceResult = z.infer<typeof SeminarAttendanceResultSchema>
export type SeminarIssueInput = z.infer<typeof SeminarIssueSchema>
export type SeminarIssueResult = z.infer<typeof SeminarIssueResultSchema>
