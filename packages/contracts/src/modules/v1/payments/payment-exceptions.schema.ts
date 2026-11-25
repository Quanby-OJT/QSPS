import { z } from "zod"

import { BookingStatusSchema, ReferenceNumberSchema } from "../bookings/bookings.schema.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/**
 * Why a succeeded Payment needs review (PAY-6):
 * - `late_payment`: the money arrived after the Booking was closed
 *   (cancelled, forfeited); the Booking stays closed (D7).
 * - `duplicate`: the Booking was already paid by another Payment; no second
 *   receipt was issued.
 */
export const PAYMENT_REVIEW_REASONS = ["late_payment", "duplicate"] as const
export const PaymentReviewReasonSchema = z.enum(PAYMENT_REVIEW_REASONS)

/** How staff resolved it. Refunding the money itself is PAY-7. */
export const PAYMENT_REVIEW_RESOLUTIONS = ["rebooked", "refund_requested"] as const
export const PaymentReviewResolutionSchema = z.enum(PAYMENT_REVIEW_RESOLUTIONS)

/** One open payment exception, as staff see it in the admin portal. */
export const PaymentExceptionSchema = z.object({
	paymentId: z.number().int().positive(),
	reason: PaymentReviewReasonSchema,
	bookingId: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	bookingStatus: BookingStatusSchema,
	clientName: z.string(),
	/** Null when the client has no email (a mobile-only walk-in): show "No email". */
	clientEmail: z.string().nullable(),
	amountCentavos: z.number().int().min(0),
	channelCode: z.string(),
	providerCode: z.string(),
	/** When the Payment succeeded. */
	paidAt: dateField,
	/** The receipt, when one was issued (none for a duplicate). */
	receiptNumber: z.string().nullable(),
})

export const PaymentExceptionListSchema = z.object({
	exceptions: z.array(PaymentExceptionSchema),
})

export const ResolvePaymentReviewSchema = z
	.object({
		paymentId: z.coerce.number().int().positive(),
		resolution: PaymentReviewResolutionSchema,
		/** Why, in staff's words. Kept on the Payment; not copied to the audit log. */
		note: z.string().trim().min(3, "Say how this was resolved").max(1000),
		/** Required when rebooked: the new Booking made for the same client. */
		rebookedReferenceNumber: z.string().trim().toUpperCase().optional(),
	})
	.superRefine((input, ctx) => {
		if (input.resolution === "rebooked" && !input.rebookedReferenceNumber) {
			ctx.addIssue({
				code: "custom",
				path: ["rebookedReferenceNumber"],
				message: "Enter the Reference Number of the new booking",
			})
		}
	})

export const ResolvePaymentReviewResultSchema = z.object({
	paymentId: z.number().int().positive(),
	resolution: PaymentReviewResolutionSchema,
	refundRequestId: z.number().int().positive().nullable(),
})

export type PaymentReviewReason = z.infer<typeof PaymentReviewReasonSchema>
export type PaymentReviewResolution = z.infer<typeof PaymentReviewResolutionSchema>
export type PaymentException = z.infer<typeof PaymentExceptionSchema>
export type PaymentExceptionList = z.infer<typeof PaymentExceptionListSchema>
export type ResolvePaymentReviewInput = z.infer<typeof ResolvePaymentReviewSchema>
export type ResolvePaymentReviewResult = z.infer<typeof ResolvePaymentReviewResultSchema>
