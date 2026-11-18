import { z } from "zod"

import {
	BookingItemStatusSchema,
	BookingStatusSchema,
	ReferenceNumberSchema,
} from "../bookings/bookings.schema.js"
import { BusinessDateSchema } from "../schedules/schedules.schema.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/** What staff decide when they finish assessing a Booking Item (DOMAIN-MODEL.md `assessments`). */
export const ASSESSMENT_OUTCOMES = ["cleared", "returned", "rejected"] as const
export const AssessmentOutcomeSchema = z.enum(ASSESSMENT_OUTCOMES)

/** Longest note staff can write on one assessment. */
export const MAX_ASSESSMENT_NOTES_LENGTH = 2000
/** Most corrected fields one assessment can record. */
export const MAX_CORRECTIONS = 50

/**
 * Annex B: Paid when the Booking is `paid` or `completed`, otherwise Unpaid.
 * Shown in the queue so staff see at a glance who can be checked in.
 */
export const QueuePaymentStatusSchema = z.enum(["paid", "unpaid"])

/** The day's queue at the staff user's Location. Defaults to today in Manila. */
export const ProcessingQueueRequestSchema = z.object({
	date: BusinessDateSchema.optional(),
})

export const QueueItemSchema = z.object({
	bookingItemId: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	clientName: z.string(),
	serviceName: z.string(),
	startsAt: dateField,
	endsAt: dateField,
	status: BookingItemStatusSchema,
	bookingStatus: BookingStatusSchema,
	paymentStatus: QueuePaymentStatusSchema,
})

export const ProcessingQueueSchema = z.object({
	/** The staff user's Location; null when they have none, so the queue is empty. */
	location: z.object({ id: z.number().int().positive(), name: z.string() }).nullable(),
	date: BusinessDateSchema,
	items: z.array(QueueItemSchema),
})

/** Typed by staff, or filled by a handheld scanner reading the booking's QR code. */
export const CheckInSchema = z.object({
	referenceNumber: z
		.string()
		.trim()
		.transform(value => value.toUpperCase())
		.pipe(ReferenceNumberSchema),
})

export const BookingItemIdParamSchema = z.object({
	bookingItemId: z.coerce.number().int().positive(),
})

const CorrectionsSchema = z
	.record(z.string().trim().min(1).max(100), z.string().trim().max(500))
	.refine(value => Object.keys(value).length <= MAX_CORRECTIONS, {
		message: `Record at most ${MAX_CORRECTIONS} corrections`,
	})

export const RecordAssessmentSchema = BookingItemIdParamSchema.extend({
	outcome: AssessmentOutcomeSchema,
	notes: z.string().trim().max(MAX_ASSESSMENT_NOTES_LENGTH).default(""),
	corrections: CorrectionsSchema.default({}),
}).refine(value => value.outcome === "cleared" || value.notes.length > 0, {
	message: "Write a note telling the client why it was returned or rejected",
	path: ["notes"],
})

export const AssessmentSchema = z.object({
	id: z.number().int().positive(),
	outcome: AssessmentOutcomeSchema,
	notes: z.string().nullable(),
	corrections: z.record(z.string(), z.string()),
	staffId: z.string(),
	staffName: z.string(),
	createdAt: dateField,
})

/** Everything the assessment screen shows for one Booking Item. */
export const ProcessingItemSchema = z.object({
	bookingItemId: z.number().int().positive(),
	status: BookingItemStatusSchema,
	booking: z.object({
		id: z.number().int().positive(),
		referenceNumber: ReferenceNumberSchema,
		status: BookingStatusSchema,
		kind: z.string(),
		totalCentavos: z.number().int().min(0),
	}),
	paymentStatus: QueuePaymentStatusSchema,
	service: z.object({
		id: z.number().int().positive(),
		name: z.string(),
		requiresApproval: z.boolean(),
	}),
	location: z.object({ id: z.number().int().positive(), name: z.string() }),
	startsAt: dateField,
	endsAt: dateField,
	feeCentavos: z.number().int().min(0),
	/** The client's own profile, as they entered it (AUTH-1). */
	client: z.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
		mobile: z.string().nullable(),
		birthDate: z.string().nullable(),
		gender: z.string().nullable(),
		nationality: z.string().nullable(),
	}),
	/**
	 * Form Submission answers for this item. Always empty until the forms epic
	 * adds `form_submissions`; the screen already shows them when present.
	 */
	formAnswers: z.record(z.string(), z.unknown()),
	/** Newest first. */
	assessments: z.array(AssessmentSchema),
})

export const CheckInResponseSchema = z.object({
	items: z.array(ProcessingItemSchema).min(1),
})

export type AssessmentOutcome = z.infer<typeof AssessmentOutcomeSchema>
export type QueuePaymentStatus = z.infer<typeof QueuePaymentStatusSchema>
export type ProcessingQueueRequest = z.infer<typeof ProcessingQueueRequestSchema>
export type QueueItem = z.infer<typeof QueueItemSchema>
export type ProcessingQueue = z.infer<typeof ProcessingQueueSchema>
export type CheckInInput = z.infer<typeof CheckInSchema>
export type BookingItemIdParam = z.infer<typeof BookingItemIdParamSchema>
export type RecordAssessmentInput = z.infer<typeof RecordAssessmentSchema>
export type Assessment = z.infer<typeof AssessmentSchema>
export type ProcessingItem = z.infer<typeof ProcessingItemSchema>
export type CheckInResponse = z.infer<typeof CheckInResponseSchema>
