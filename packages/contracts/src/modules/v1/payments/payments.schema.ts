import { z } from "zod"

import { BookingStatusSchema, ReferenceNumberSchema } from "../bookings/bookings.schema.js"

/** Payment statuses, state machine 5.3 in DOMAIN-MODEL.md. */
export const PAYMENT_STATUSES = [
	"initiated",
	"pending",
	"succeeded",
	"failed",
	"expired",
	"refunded",
] as const

export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES)

/** A provider or channel code: lowercase letters, digits and dashes, e.g. "fake", "linkbiz". */
export const PaymentCodeSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]{1,31}$/, "Codes are lowercase letters, digits and dashes")

/**
 * Pay one Booking online. Until PAY-5 adds the channel list, the channel code
 * is the provider code.
 */
export const CreatePaymentSchema = z.object({
	bookingId: z.number().int().positive(),
	channelCode: PaymentCodeSchema,
})

/** What the client needs to go to the provider's hosted checkout. */
export const PaymentCheckoutSchema = z.object({
	paymentId: z.number().int().positive(),
	status: PaymentStatusSchema,
	amountCentavos: z.number().int().min(0),
	convenienceFeeCentavos: z.number().int().min(0),
	checkoutUrl: z.url(),
})

export const PaymentIdParamSchema = z.object({
	paymentId: z.coerce.number().int().positive(),
})

/**
 * A Payment as the return page sees it. The page polls this until the
 * Payment leaves `initiated` / `pending`; it never changes anything itself.
 */
export const PaymentStatusResponseSchema = z.object({
	paymentId: z.number().int().positive(),
	bookingId: z.number().int().positive(),
	referenceNumber: ReferenceNumberSchema,
	status: PaymentStatusSchema,
	bookingStatus: BookingStatusSchema,
	amountCentavos: z.number().int().min(0),
	/** Set once the Payment succeeded and its e-Receipt exists (PAY-2). */
	receiptNumber: z.string().nullable(),
})

/** A Receipt Verification Token: 128 random bits, base64url (22 characters). */
export const ReceiptTokenSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]{22}$/, "Not a receipt verification token")

export const ReceiptTokenParamSchema = z.object({ token: ReceiptTokenSchema })

/**
 * What the public verification page shows for a scanned receipt QR code.
 * Read from the database, never from the PDF; carries no personal data.
 */
export const ReceiptVerificationSchema = z.object({
	receiptNumber: z.string(),
	amountCentavos: z.number().int().min(0),
	issuedAt: z
		.union([z.date(), z.string()])
		.transform(value => (typeof value === "string" ? new Date(value) : value)),
	/** `valid` while the money is kept; `refunded` once the Payment is refunded. */
	status: z.enum(["valid", "refunded"]),
})

export type PaymentStatus = z.infer<typeof PaymentStatusSchema>
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>
export type PaymentCheckout = z.infer<typeof PaymentCheckoutSchema>
export type PaymentStatusResponse = z.infer<typeof PaymentStatusResponseSchema>
export type ReceiptVerification = z.infer<typeof ReceiptVerificationSchema>
