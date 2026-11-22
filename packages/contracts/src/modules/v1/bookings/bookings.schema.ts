import { z } from "zod"

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

export const BookingStatusSchema = z.enum(BOOKING_STATUSES)
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
	status: BookingItemStatusSchema,
})

export const BookingSchema = z.object({
	id: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	status: BookingStatusSchema,
	kind: BookingKindSchema,
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
 * Book one Service in one Schedule Slot. The slot already fixes the service,
 * the location and the time. The client also sends the ids of the policy
 * versions it accepted on the review step (ADM-9); every applicable policy
 * that requires acceptance must be among them.
 */
export const CreateBookingSchema = z.object({
	scheduleSlotId: z.number().int().positive(),
	acceptedPolicyDocumentIds: z
		.array(z.number().int().positive())
		.max(100)
		.default([])
		.transform(ids => [...new Set(ids)]),
})

/** One of the caller's own Bookings, by id (BKG-2). */
export const BookingIdParamSchema = z.object({
	bookingId: z.coerce.number().int().positive(),
})

export type BookingStatus = z.infer<typeof BookingStatusSchema>
export type BookingCancelReason = z.infer<typeof BookingCancelReasonSchema>
export type BookingKind = z.infer<typeof BookingKindSchema>
export type BookingItemStatus = z.infer<typeof BookingItemStatusSchema>
export type BookingItem = z.infer<typeof BookingItemSchema>
export type Booking = z.infer<typeof BookingSchema>
export type CreateBookingInput = z.infer<typeof CreateBookingSchema>
