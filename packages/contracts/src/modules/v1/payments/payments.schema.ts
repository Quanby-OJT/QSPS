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

/** Largest fixed convenience fee accepted: PHP 10,000.00. */
export const MAX_CONVENIENCE_FEE_CENTAVOS = 1_000_000

/** A channel as the settings screen shows and edits it (PAY-5). */
export const PaymentChannelSchema = z.object({
	code: PaymentCodeSchema,
	name: z.string(),
	/** The provider that serves the channel; null until one is assigned. */
	providerCode: z.string().nullable(),
	convenienceFeeCentavos: z.number().int().min(0),
	/** Percentage of the Service fees, in basis points (250 = 2.5%). */
	convenienceFeeBps: z.number().int().min(0),
	isEnabled: z.boolean(),
})

/** The settings screen: every channel, and the providers this deployment has. */
export const PaymentChannelSettingsSchema = z.object({
	channels: z.array(PaymentChannelSchema),
	providerCodes: z.array(z.string()),
})

/** Change one channel. The whole row is sent, so the audit shows old and new values. */
export const UpdatePaymentChannelSchema = z
	.object({
		code: PaymentCodeSchema,
		name: z.string().trim().min(1, "Enter a name").max(60),
		providerCode: PaymentCodeSchema.nullable(),
		convenienceFeeCentavos: z.number().int().min(0).max(MAX_CONVENIENCE_FEE_CENTAVOS),
		convenienceFeeBps: z.number().int().min(0).max(10_000),
		isEnabled: z.boolean(),
	})
	.refine(input => !input.isEnabled || input.providerCode !== null, {
		message: "Choose a provider before enabling the channel",
		path: ["providerCode"],
	})

export const CheckoutChannelsParamSchema = z.object({
	bookingId: z.coerce.number().int().positive(),
})

/** One channel offered at checkout, with its fee worked out for this booking. */
export const CheckoutChannelSchema = z.object({
	code: PaymentCodeSchema,
	name: z.string(),
	convenienceFeeCentavos: z.number().int().min(0),
	totalCentavos: z.number().int().min(0),
})

/** What the client sees before paying: Service fees, then each channel's fee and total. */
export const CheckoutChannelsSchema = z.object({
	bookingId: z.number().int().positive(),
	subtotalCentavos: z.number().int().min(0),
	channels: z.array(CheckoutChannelSchema),
})

export type PaymentStatus = z.infer<typeof PaymentStatusSchema>
export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>
export type PaymentCheckout = z.infer<typeof PaymentCheckoutSchema>
export type PaymentStatusResponse = z.infer<typeof PaymentStatusResponseSchema>
export type ReceiptVerification = z.infer<typeof ReceiptVerificationSchema>
export type PaymentChannel = z.infer<typeof PaymentChannelSchema>
export type PaymentChannelSettings = z.infer<typeof PaymentChannelSettingsSchema>
export type UpdatePaymentChannelInput = z.infer<typeof UpdatePaymentChannelSchema>
export type CheckoutChannel = z.infer<typeof CheckoutChannelSchema>
export type CheckoutChannels = z.infer<typeof CheckoutChannelsSchema>
