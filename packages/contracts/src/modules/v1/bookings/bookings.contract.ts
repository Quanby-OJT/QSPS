import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	ApplicablePoliciesRequestSchema,
	PolicyDocumentSummarySchema,
} from "../policies/policy-documents.schema.js"
import { BookingSchema, CreateBookingSchema } from "./bookings.schema.js"

export const bookingsContract = {
	create: oc
		.route({
			method: "POST",
			path: "/bookings",
			summary: "Book a service in an available slot",
			description:
				"Creates a Booking in pending_payment with one Booking Item and reserves one place in the slot (Book Now, Pay Later). Refused when the slot is full, disabled or already started, when the client has another unpaid booking, or when an applicable policy that requires acceptance is not among acceptedPolicyDocumentIds (ADM-9). Accepted versions are stored against the Booking.",
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
}
