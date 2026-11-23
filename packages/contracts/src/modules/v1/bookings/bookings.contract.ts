import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	ApplicablePoliciesRequestSchema,
	PolicyDocumentSummarySchema,
} from "../policies/policy-documents.schema.js"
import { BookingIdParamSchema, BookingSchema, CreateBookingSchema } from "./bookings.schema.js"

export const bookingsContract = {
	create: oc
		.route({
			method: "POST",
			path: "/bookings",
			summary: "Book one or more services in one checkout",
			description:
				"Creates one Booking in pending_payment with one Booking Item per slot and reserves one place in each slot, all together or not at all (Book Now, Pay Later; BKG-3). The total is the sum of the item fees. Refused, with nothing created, when any slot is full, disabled or already started (the error names that Service and its data carries the scheduleSlotId), when the same Service is chosen twice, when the client has another unpaid booking, or when a policy that requires acceptance for any of the Services is not among acceptedPolicyDocumentIds (ADM-9). Accepted versions are stored against the Booking.",
			tags: ["Bookings"],
		})
		.input(CreateBookingSchema)
		.output(BookingSchema),

	policies: oc
		.route({
			method: "GET",
			path: "/bookings/policies",
			summary: "Policies that apply to booking a service",
			description:
				"The written policies a client must read, and may have to accept, before booking this Service today (ADM-9). Requires bookings.own:create.",
			tags: ["Bookings"],
		})
		.input(ApplicablePoliciesRequestSchema)
		.output(z.array(PolicyDocumentSummarySchema)),

	unpaid: oc
		.route({
			method: "GET",
			path: "/bookings/unpaid",
			summary: "The caller's booking awaiting payment",
			description:
				"The caller's one pending_payment Booking, or null when there is none (BKG-2: one unpaid booking per client). Requires bookings.own:read.",
			tags: ["Bookings"],
		})
		.output(BookingSchema.nullable()),

	cancel: oc
		.route({
			method: "POST",
			path: "/bookings/{bookingId}/cancel",
			summary: "Cancel your own unpaid booking",
			description:
				"Cancels a pending_payment Booking the caller owns with reason client_cancelled and releases its slot places in the same transaction (BKG-2). Refused while a payment for it is still being processed. Requires bookings.own:cancel.",
			tags: ["Bookings"],
		})
		.input(BookingIdParamSchema)
		.output(BookingSchema),

	payOnsite: oc
		.route({
			method: "POST",
			path: "/bookings/{bookingId}/pay-onsite",
			summary: "Pay at the BOQ cashier instead",
			description:
				"Marks a pending_payment Booking the caller owns as paid onsite (BKG-2). The hold no longer applies; the Booking is cancelled as no_show if still unpaid when the arrival cutoff (booking.arrival_cutoff_minutes) passes. Requires payments.own:create.",
			tags: ["Bookings"],
		})
		.input(BookingIdParamSchema)
		.output(BookingSchema),
}
