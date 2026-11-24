import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	PaymentExceptionListSchema,
	ResolvePaymentReviewResultSchema,
	ResolvePaymentReviewSchema,
} from "./payment-exceptions.schema.js"

/**
 * Payment exceptions (PAY-6): succeeded Payments flagged `needs_review` that
 * staff have not resolved yet, inside the caller's Scope.
 */
export const paymentExceptionsContract = {
	list: oc
		.route({
			method: "GET",
			path: "/payment-exceptions",
			summary: "List open payment exceptions",
			description:
				"Late payments on closed Bookings and duplicate payments, newest first. Needs payments.transactions:read; only Bookings with a Service in the caller's Scope.",
			tags: ["Payments"],
		})
		.input(z.object({}))
		.output(PaymentExceptionListSchema),
	resolve: oc
		.route({
			method: "POST",
			path: "/payment-exceptions/{paymentId}/resolve",
			summary: "Resolve a payment exception",
			description:
				"Record that staff rebooked the client (with the new Reference Number) or opened a Refund Request. Needs bookings.all:override. Recorded on the Payment and audited; a Payment is resolved once (409 after).",
			tags: ["Payments"],
		})
		.input(ResolvePaymentReviewSchema)
		.output(ResolvePaymentReviewResultSchema),
}
