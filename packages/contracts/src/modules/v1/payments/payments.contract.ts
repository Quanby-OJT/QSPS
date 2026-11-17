import { oc } from "@orpc/contract"

import {
	CreatePaymentSchema,
	PaymentCheckoutSchema,
	PaymentIdParamSchema,
	PaymentStatusResponseSchema,
} from "./payments.schema.js"

/**
 * Client-facing payment routes. The provider notification endpoint is not
 * here: it is a plain public route that must read the raw request body to
 * check the signature (PaymentNotificationsController).
 */
export const paymentsContract = {
	create: oc
		.route({
			method: "POST",
			path: "/payments",
			summary: "Pay a booking online",
			description:
				"Creates a Payment for a pending_payment Booking the caller owns and returns the provider's hosted checkout URL for the exact amount. The Booking is only marked paid when the provider's signed notification arrives.",
			tags: ["Payments"],
		})
		.input(CreatePaymentSchema)
		.output(PaymentCheckoutSchema),
	status: oc
		.route({
			method: "GET",
			path: "/payments/{paymentId}",
			summary: "Read a payment's status",
			description:
				"Used by the checkout return page to poll until the provider's notification has been processed. Read-only.",
			tags: ["Payments"],
		})
		.input(PaymentIdParamSchema)
		.output(PaymentStatusResponseSchema),
}
