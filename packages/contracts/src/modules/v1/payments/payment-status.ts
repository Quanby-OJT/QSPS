import { z } from "zod"

/**
 * Payment statuses, state machine 5.3 in DOMAIN-MODEL.md. In its own file so
 * bookings.schema can use it without importing payments.schema, which itself
 * imports bookings.schema (a cycle breaks module loading).
 */
export const PAYMENT_STATUSES = [
	"initiated",
	"pending",
	"succeeded",
	"failed",
	"expired",
	"refunded",
] as const

export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES)
