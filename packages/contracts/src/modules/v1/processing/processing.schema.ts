import { z } from "zod"

import {
	BookingItemStatusSchema,
	BookingStatusSchema,
	ReferenceNumberSchema,
} from "../bookings/bookings.schema.js"
import { IcvIssueDetailsSchema } from "../certificates/certificates.schema.js"
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
	/**
	 * Certificate details (CRT-1). Required when clearing an item whose Service
	 * issues its document automatically; ignored otherwise.
	 */
	document: IcvIssueDetailsSchema.nullish(),
}).refine(value => value.outcome === "cleared" || value.notes.length > 0, {
	message: "Write a note telling the client why it was returned or rejected",
	path: ["notes"],
})

/**
 * Who made a decision (PRC-3): the Processing Officer's `assessment`, the
 * head's `approval` of a pending item, or the head's `override` of a
 * rejected one.
 */
export const ASSESSMENT_KINDS = ["assessment", "approval", "override"] as const
export const AssessmentKindSchema = z.enum(ASSESSMENT_KINDS)

export const AssessmentSchema = z.object({
	id: z.number().int().positive(),
	outcome: AssessmentOutcomeSchema,
	kind: AssessmentKindSchema,
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
		/** The document this Service issues (CRT-1); null when it issues none. */
		documentType: z.string().nullable(),
		/** Issue the document as soon as the item is cleared (CRT-1). */
		autoIssue: z.boolean(),
	}),
	/** The item's valid document, once issued (CRT-1). */
	document: z.object({ id: z.number().int().positive(), documentNumber: z.string() }).nullable(),
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
	 * FRM-2: the client's Form Submission answers, question label to answer, in question order. Empty when the item has no submission.
	 */
	formAnswers: z.record(z.string(), z.unknown()),
	/** FRM-2c: the answered file questions, by question id and the label used in `formAnswers`. Staff download each from GET /processing/items/{bookingItemId}/answers/{fieldId}/file. */
	formFiles: z
		.array(z.object({ fieldId: z.number().int().positive(), label: z.string() }))
		.optional(),
	/** Newest first. */
	assessments: z.array(AssessmentSchema),
})

export const CheckInResponseSchema = z.object({
	items: z.array(ProcessingItemSchema).min(1),
})

/** Shortest override reason staff may write (PRC-3: the reason is mandatory). */
export const MIN_OVERRIDE_REASON_LENGTH = 10

/** The two lists on the approvals screen (PRC-3). */
export const APPROVAL_QUEUE_VIEWS = ["pending", "rejected"] as const
export const ApprovalQueueViewSchema = z.enum(APPROVAL_QUEUE_VIEWS)

export const ApprovalQueueRequestSchema = z.object({
	/** `pending`: items waiting for head approval. `rejected`: items an approver may override. */
	view: ApprovalQueueViewSchema.default("pending"),
})

export const ApprovalQueueItemSchema = z.object({
	bookingItemId: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	status: BookingItemStatusSchema,
	clientName: z.string(),
	serviceName: z.string(),
	location: z.object({ id: z.number().int().positive(), name: z.string() }),
	startsAt: dateField,
	/** The officer whose Assessment put the item here, and when. */
	assessedBy: z.string().nullable(),
	assessedAt: dateField.nullable(),
	/** The officer's notes on that Assessment. */
	notes: z.string().nullable(),
})

export const ApprovalQueueSchema = z.object({
	view: ApprovalQueueViewSchema,
	items: z.array(ApprovalQueueItemSchema),
})

/** The head's decision on a `pending_head_approval` item. */
export const APPROVAL_DECISIONS = ["approve", "return"] as const
export const ApprovalDecisionSchema = z.enum(APPROVAL_DECISIONS)

export const DecideApprovalSchema = BookingItemIdParamSchema.extend({
	decision: ApprovalDecisionSchema,
	notes: z.string().trim().max(MAX_ASSESSMENT_NOTES_LENGTH).default(""),
	/**
	 * Certificate details (CRT-1a). Required when this makes the item cleared and
	 * its Service issues its document automatically; ignored otherwise.
	 */
	document: IcvIssueDetailsSchema.nullish(),
}).refine(value => value.decision === "approve" || value.notes.length > 0, {
	message: "Write a note telling the officer what to check again",
	path: ["notes"],
})

export const OverrideItemSchema = BookingItemIdParamSchema.extend({
	reason: z
		.string()
		.trim()
		.min(MIN_OVERRIDE_REASON_LENGTH, {
			message: `Write the reason for the override (at least ${MIN_OVERRIDE_REASON_LENGTH} characters)`,
		})
		.max(MAX_ASSESSMENT_NOTES_LENGTH),
	/**
	 * Certificate details (CRT-1a). Required when this makes the item cleared and
	 * its Service issues its document automatically; ignored otherwise.
	 */
	document: IcvIssueDetailsSchema.nullish(),
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
export type AssessmentKind = z.infer<typeof AssessmentKindSchema>
export type ApprovalQueueView = z.infer<typeof ApprovalQueueViewSchema>
export type ApprovalQueueRequest = z.infer<typeof ApprovalQueueRequestSchema>
export type ApprovalQueueItem = z.infer<typeof ApprovalQueueItemSchema>
export type ApprovalQueue = z.infer<typeof ApprovalQueueSchema>
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>
export type DecideApprovalInput = z.infer<typeof DecideApprovalSchema>
export type OverrideItemInput = z.infer<typeof OverrideItemSchema>
