import { oc } from "@orpc/contract"

import { BookingSchema, CreateBookingSchema } from "./bookings.schema.js"

export const bookingsContract = {
	create: oc
		.route({
			method: "POST",
			path: "/bookings",
			summary: "Book a service in an available slot",
			description:
				"Creates a Booking in pending_payment with one Booking Item and reserves one place in the slot (Book Now, Pay Later). Refused when the slot is full, disabled or already started, or when the client has another unpaid booking.",
			tags: ["Bookings"],
		})
		.input(CreateBookingSchema)
		.output(BookingSchema),
}
