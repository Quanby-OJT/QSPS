import { oc } from "@orpc/contract"

import {
	CashierBookingIdParamSchema,
	CashierBookingSchema,
	CashierSearchResultSchema,
	CashierSearchSchema,
	CollectOnsiteResultSchema,
	CollectOnsiteSchema,
} from "./cashier.schema.js"

/**
 * The cashier screen (PAY-4): `payments.onsite:collect`, inside the caller's
 * Scope. The receipt print route is a plain route that answers with PDF
 * bytes (CashierReceiptsController).
 */
export const cashierContract = {
	search: oc
		.route({
			method: "GET",
			path: "/cashier/bookings",
			summary: "Find a booking at the cashier",
			description:
				"By Reference Number (typed or scanned from the booking QR), client email, or part of the client's name. Only bookings with a Service in the caller's Scope are returned, unpaid ones first, each with its fee breakdown.",
			tags: ["Cashier"],
		})
		.input(CashierSearchSchema)
		.output(CashierSearchResultSchema),
	get: oc
		.route({
			method: "GET",
			path: "/cashier/bookings/{bookingId}",
			summary: "Read one booking at the cashier",
			tags: ["Cashier"],
		})
		.input(CashierBookingIdParamSchema)
		.output(CashierBookingSchema),
	collect: oc
		.route({
			method: "POST",
			path: "/cashier/bookings/{bookingId}/collect",
			summary: "Record an onsite payment",
			description:
				"Creates a Payment with provider onsite, confirms it through PaymentService.confirm (booking paid, e-Receipt issued) and records the cashier in collected_by. Send an Idempotency-Key so a double click cannot create two Payments. A paid or cancelled booking answers 409 with its current status.",
			tags: ["Cashier"],
		})
		.input(CollectOnsiteSchema)
		.output(CollectOnsiteResultSchema),
}
