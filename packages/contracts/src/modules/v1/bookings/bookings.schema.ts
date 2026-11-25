import { z } from "zod"

import { DocumentStatusSchema, DocumentTypeSchema } from "../certificates/certificates.schema.js"
import {
	FORM_UPLOAD_CONTENT_TYPES,
	FORM_UPLOAD_MAX_BYTES,
	FormAnswersSchema,
} from "../forms/form-answers.js"
import { FormFieldSchema } from "../forms/forms.schema.js"
import { PaymentStatusSchema } from "../payments/payment-status.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/** Booking statuses, state machine 5.1 in DOMAIN-MODEL.md. */
export const BOOKING_STATUSES = [
	"pending_approval",
	"pending_payment",
	"paid",
	"completed",
	"cancelled",
	"rejected",
	"forfeited",
	"refund_requested",
	"refunded",
] as const

/**
 * Client-facing Booking status labels (BKG-4, DOMAIN-MODEL.md section 5.1):
 * - Pending: pending_approval, pending_payment
 * - Paid: paid, completed, refund_requested (money still held until refunded)
 * - Cancelled: cancelled, rejected, forfeited, refunded
 */
export const CLIENT_BOOKING_STATUSES = ["Pending", "Paid", "Cancelled"] as const

export const BOOKING_KINDS = ["regular", "expedite", "vip", "walk-in"] as const

/** Booking Item statuses, state machine 5.2 in DOMAIN-MODEL.md. */
export const BOOKING_ITEM_STATUSES = [
	"booked",
	"checked_in",
	"in_assessment",
	"returned",
	"cleared",
	"pending_head_approval",
	"issued",
	"rejected",
	"no_show",
] as const

/** Why a Booking was cancelled (BKG-2). */
export const BOOKING_CANCEL_REASONS = ["hold_expired", "no_show", "client_cancelled"] as const

/** Most Services one checkout may hold (BKG-3). */
export const MAX_BOOKING_ITEMS = 10

export const BookingStatusSchema = z.enum(BOOKING_STATUSES)
export const ClientBookingStatusSchema = z.enum(CLIENT_BOOKING_STATUSES)
export const BookingCancelReasonSchema = z.enum(BOOKING_CANCEL_REASONS)
export const BookingKindSchema = z.enum(BOOKING_KINDS)
export const BookingItemStatusSchema = z.enum(BOOKING_ITEM_STATUSES)

/** QSPS-YYMMDD-XXXXXX: the Manila booking date, then six letters or digits. */
export const REFERENCE_NUMBER_PATTERN = /^QSPS-\d{6}-[A-Z0-9]{6}$/

export const ReferenceNumberSchema = z
	.string()
	.regex(REFERENCE_NUMBER_PATTERN, "Reference numbers look like QSPS-261117-AB12CD")

export const BookingItemSchema = z.object({
	id: z.number().int().positive(),
	serviceId: z.number().int().positive(),
	serviceName: z.string(),
	locationId: z.number().int().positive(),
	locationName: z.string(),
	scheduleSlotId: z.number().int().positive(),
	startsAt: dateField,
	endsAt: dateField,
	feeCentavos: z.number().int().min(0),
	rescheduleCount: z.number().int().min(0),
	status: BookingItemStatusSchema,
})

export const BookingSchema = z.object({
	id: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	status: BookingStatusSchema,
	kind: BookingKindSchema,
	/** The sum of the items' fees (BKG-3). */
	totalCentavos: z.number().int().min(0),
	/** When an unpaid booking stops holding its slot. Null once paid or once onsite payment is chosen. */
	holdExpiresAt: dateField.nullable(),
	/** BKG-2: the client will pay at the BOQ cashier; the arrival cutoff applies instead of the hold. */
	payOnsite: z.boolean(),
	/** BKG-2: set only when `status` is `cancelled`. */
	cancelReason: BookingCancelReasonSchema.nullable(),
	cancelledAt: dateField.nullable(),
	createdAt: dateField,
	items: z.array(BookingItemSchema).min(1),
})

/**
 * One Booking row in the client's "My Transactions" list (BKG-4).
 * Lists Reference Number, Services, schedule, total, and client-facing status.
 */
export const BookingSummarySchema = z.object({
	id: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	status: BookingStatusSchema,
	clientStatus: ClientBookingStatusSchema,
	totalCentavos: z.number().int().min(0),
	payOnsite: z.boolean(),
	holdExpiresAt: dateField.nullable(),
	createdAt: dateField,
	items: z.array(BookingItemSchema).min(1),
})

export const MyBookingsResponseSchema = z.object({
	bookings: z.array(BookingSummarySchema),
})

/** Payment details shown on the client's Booking detail view (BKG-4). */
export const BookingPaymentDetailSchema = z.object({
	id: z.number().int().positive(),
	amountCentavos: z.number().int().min(0),
	convenienceFeeCentavos: z.number().int().min(0),
	providerCode: z.string(),
	channelCode: z.string().nullable(),
	channelName: z.string().nullable(),
	status: PaymentStatusSchema,
	paidAt: dateField.nullable(),
	createdAt: dateField,
})

/** e-Receipt metadata linked from the client's Booking detail view (BKG-4). */
export const BookingReceiptDetailSchema = z.object({
	id: z.number().int().positive(),
	paymentId: z.number().int().positive(),
	receiptNumber: z.string(),
	verificationToken: z.string(),
	issuedAt: dateField,
})

/** Issued Document summary shown on the client's Booking detail view (BKG-4). */
export const BookingIssuedDocumentSchema = z.object({
	id: z.number().int().positive(),
	bookingItemId: z.number().int().positive(),
	serviceName: z.string(),
	documentType: DocumentTypeSchema,
	documentNumber: z.string(),
	status: DocumentStatusSchema,
	issuedAt: dateField,
	validUntil: z.string().nullable(),
})

/**
 * Full client Booking details (BKG-4): Booking header, each item's processing
 * status, payment details, e-Receipt, and any issued Documents.
 */
export const BookingDetailSchema = BookingSchema.extend({
	clientStatus: ClientBookingStatusSchema,
	payment: BookingPaymentDetailSchema.nullable(),
	receipt: BookingReceiptDetailSchema.nullable(),
	documents: z.array(BookingIssuedDocumentSchema),
})

/**
 * FRM-2: the client's answers to one Service's questionnaire, with the
 * version they were shown. The API refuses them if that version is no
 * longer the Service's active one.
 */
export const BookingItemFormInputSchema = z.object({
	formTemplateId: z.number().int().positive(),
	answers: FormAnswersSchema,
})

/**
- One Service in a checkout. The slot already fixes the service, the location
- and the time. `form` is required when the Service has an active
- questionnaire (FRM-2).
 */
export const CreateBookingItemSchema = z.object({
	scheduleSlotId: z.number().int().positive(),
	form: BookingItemFormInputSchema.optional(),
})

/**
- Book one or more Services in one checkout (BKG-1, BKG-3): one Booking with
- one Booking Item per slot, reserved all together or not at all. Each slot
- may appear once. The client also sends the ids of the policy versions it
- accepted on the review step (ADM-9); every applicable policy that requires
- acceptance, for any of the Services, must be among them.
 */
export const CreateBookingSchema = z.object({
	items: z
		.array(CreateBookingItemSchema)
		.min(1, "Choose at least one service")
		.max(MAX_BOOKING_ITEMS, `Book at most ${MAX_BOOKING_ITEMS} services in one checkout`)
		.refine(
			items => new Set(items.map(item => item.scheduleSlotId)).size === items.length,
			"Each slot can be chosen once"
		),
	acceptedPolicyDocumentIds: z
		.array(z.number().int().positive())
		.max(100)
		.default([])
		.transform(ids => [...new Set(ids)]),
})

/** One of the caller's own Bookings, by id (BKG-2, BKG-4). */
export const BookingIdParamSchema = z.object({
	bookingId: z.coerce.number().int().positive(),
})

/** BKG-5: move one booked item to another open slot for the same service and location. */
export const RescheduleBookingItemSchema = z.object({
	bookingId: z.coerce.number().int().positive(),
	bookingItemId: z.coerce.number().int().positive(),
	scheduleSlotId: z.number().int().positive(),
})

/** FRM-2: which Service's questionnaire to show in the wizard. */
export const BookingFormRequestSchema = z.object({
	serviceId: z.coerce.number().int().positive(),
})

/** FRM-2: a Service's active questionnaire, as the client answers it. */
export const BookingFormSchema = z.object({
	serviceId: z.number().int().positive(),
	formTemplateId: z.number().int().positive(),
	version: z.number().int().positive(),
	fields: z.array(FormFieldSchema),
})

const maxUploadMegabytes = FORM_UPLOAD_MAX_BYTES / (1024 * 1024)

/** FRM-2: a file answer, uploaded before the booking is confirmed. */
export const FormUploadInputSchema = z.object({
	file: z
		.file()
		.max(FORM_UPLOAD_MAX_BYTES, `Files can be at most ${maxUploadMegabytes} MB`)
		.mime(FORM_UPLOAD_CONTENT_TYPES, "Upload a PDF, JPG or PNG file"),
})

/** The stored upload. `fileKey` is what the answer holds. */
export const FormUploadSchema = z.object({
	fileKey: z.string(),
	fileName: z.string(),
	contentType: z.string(),
	sizeBytes: z.number().int().min(0),
})

/** FRM-2: replace an item's answers while its Booking is still unpaid. */
export const UpdateBookingItemFormSchema = z.object({
	bookingId: z.coerce.number().int().positive(),
	bookingItemId: z.coerce.number().int().positive(),
	formTemplateId: z.number().int().positive(),
	answers: FormAnswersSchema,
})

/** A stored Form Submission (FRM-2). */
export const FormSubmissionSchema = z.object({
	bookingItemId: z.number().int().positive(),
	formTemplateId: z.number().int().positive(),
	version: z.number().int().positive(),
	answers: FormAnswersSchema,
	createdAt: dateField,
})

export type BookingStatus = z.infer<typeof BookingStatusSchema>
export type ClientBookingStatus = z.infer<typeof ClientBookingStatusSchema>
export type BookingCancelReason = z.infer<typeof BookingCancelReasonSchema>
export type BookingKind = z.infer<typeof BookingKindSchema>
export type BookingItemStatus = z.infer<typeof BookingItemStatusSchema>
export type BookingItem = z.infer<typeof BookingItemSchema>
export type Booking = z.infer<typeof BookingSchema>
export type BookingSummary = z.infer<typeof BookingSummarySchema>
export type MyBookingsResponse = z.infer<typeof MyBookingsResponseSchema>
export type BookingPaymentDetail = z.infer<typeof BookingPaymentDetailSchema>
export type BookingReceiptDetail = z.infer<typeof BookingReceiptDetailSchema>
export type BookingIssuedDocument = z.infer<typeof BookingIssuedDocumentSchema>
export type BookingDetail = z.infer<typeof BookingDetailSchema>
export type BookingItemFormInput = z.infer<typeof BookingItemFormInputSchema>
export type CreateBookingItemInput = z.infer<typeof CreateBookingItemSchema>
export type CreateBookingInput = z.infer<typeof CreateBookingSchema>
export type RescheduleBookingItemInput = z.infer<typeof RescheduleBookingItemSchema>
export type BookingForm = z.infer<typeof BookingFormSchema>
export type FormUpload = z.infer<typeof FormUploadSchema>
export type UpdateBookingItemFormInput = z.infer<typeof UpdateBookingItemFormSchema>
export type FormSubmission = z.infer<typeof FormSubmissionSchema>