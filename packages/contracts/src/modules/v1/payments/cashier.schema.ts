import { z } from "zod"

import {
	BookingStatusSchema,
	REFERENCE_NUMBER_PATTERN,
	ReferenceNumberSchema,
} from "../bookings/bookings.schema.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/** How a client paid at the cashier (PAY-4). Stored as `payments.tender_type`. */
export const TENDER_TYPES = ["cash", "card", "check"] as const
export const TenderTypeSchema = z.enum(TENDER_TYPES)

/** Largest amount a cashier can type as received: ₱1,000,000.00. */
export const MAX_AMOUNT_RECEIVED_CENTAVOS = 100_000_000

/**
 * What the cashier typed or scanned. A booking QR code holds the Reference
 * Number, so a handheld scanner "types" it like a keyboard. Anything else is
 * a client's email or part of their name (at least 3 characters).
 */
export const CashierSearchSchema = z.object({
	q: z
		.string()
		.trim()
		.min(3, "Enter a Reference Number, an email or at least 3 letters of a name")
		.max(100),
})

/** True when the text is a whole Reference Number, e.g. from a scanned QR code. */
export function isReferenceNumber(text: string): boolean {
	return REFERENCE_NUMBER_PATTERN.test(text.trim().toUpperCase())
}

export const CashierBookingIdParamSchema = z.object({
	bookingId: z.coerce.number().int().positive(),
})

/** One Service on the booking, with its fee (the fee breakdown). */
export const CashierBookingItemSchema = z.object({
	serviceName: z.string(),
	locationName: z.string(),
	startsAt: dateField,
	endsAt: dateField,
	feeCentavos: z.number().int().min(0),
})

/**
 * A booking as the cashier sees it. Read-only: there is nothing here to edit
 * the client or the schedule (Annex A).
 */
export const CashierBookingSchema = z.object({
	bookingId: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	status: BookingStatusSchema,
	clientName: z.string(),
	clientEmail: z.string(),
	items: z.array(CashierBookingItemSchema),
	/** The Service fees. Onsite payments carry no convenience fee, so this is the amount due. */
	totalCentavos: z.number().int().min(0),
	/** The succeeded Payment, once the booking is paid, so its receipt can be printed again. */
	paidPayment: z
		.object({
			paymentId: z.number().int().positive(),
			receiptNumber: z.string().nullable(),
		})
		.nullable(),
})

export const CashierSearchResultSchema = z.object({
	bookings: z.array(CashierBookingSchema),
})

/**
 * Record a payment at the cashier. `amountDueCentavos` is the total the
 * cashier saw on screen; if the booking changed since, the API refuses
 * instead of charging a different amount. Cash may be more than the amount
 * due (the screen shows the change); card and check must match it.
 */
export const CollectOnsiteSchema = z
	.object({
		bookingId: z.coerce.number().int().positive(),
		tenderType: TenderTypeSchema,
		amountDueCentavos: z.number().int().min(0),
		amountReceivedCentavos: z.number().int().min(0).max(MAX_AMOUNT_RECEIVED_CENTAVOS),
	})
	.superRefine((input, ctx) => {
		if (input.amountReceivedCentavos < input.amountDueCentavos) {
			ctx.addIssue({
				code: "custom",
				path: ["amountReceivedCentavos"],
				message: "The amount received is less than the amount due",
			})
		}
		if (input.tenderType !== "cash" && input.amountReceivedCentavos !== input.amountDueCentavos) {
			ctx.addIssue({
				code: "custom",
				path: ["amountReceivedCentavos"],
				message: "A card or check payment must be for the exact amount due",
			})
		}
	})

export const CollectOnsiteResultSchema = z.object({
	paymentId: z.number().int().positive(),
	receiptNumber: z.string(),
	amountCentavos: z.number().int().min(0),
	changeCentavos: z.number().int().min(0),
	bookingStatus: BookingStatusSchema,
})

export type TenderType = z.infer<typeof TenderTypeSchema>
export type CashierSearchInput = z.infer<typeof CashierSearchSchema>
export type CashierBookingItem = z.infer<typeof CashierBookingItemSchema>
export type CashierBooking = z.infer<typeof CashierBookingSchema>
export type CashierSearchResult = z.infer<typeof CashierSearchResultSchema>
export type CollectOnsiteInput = z.infer<typeof CollectOnsiteSchema>
export type CollectOnsiteResult = z.infer<typeof CollectOnsiteResultSchema>
