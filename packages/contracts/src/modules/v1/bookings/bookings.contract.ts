import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	ApplicablePoliciesRequestSchema,
	PolicyDocumentSummarySchema,
} from "../policies/policy-documents.schema.js"
import {
	BookingDetailSchema,
	BookingFormRequestSchema,
	BookingFormSchema,
	BookingIdParamSchema,
	BookingSchema,
	CreateBookingSchema,
	FormSubmissionSchema,
	FormUploadInputSchema,
	FormUploadSchema,
	MyBookingsResponseSchema,
	RescheduleBookingItemSchema,
	UpdateBookingItemFormSchema,
} from "./bookings.schema.js"

export const bookingsContract = {
	create: oc
		.route({
			method: "POST",
			path: "/bookings",
			summary: "Book one or more services in one checkout",
			description:
				"Creates one Booking in pending_payment with one Booking Item per slot and reserves one place in each slot, all together or not at all (Book Now, Pay Later; BKG-3). The total is the sum of the item fees. Refused, with nothing created, when any slot is full, disabled or already started (the error names that Service and its data carries the scheduleSlotId), when the same Service is chosen twice, when the client has another unpaid booking, or when a policy that requires acceptance for any of the Services is not among acceptedPolicyDocumentIds (ADM-9). FRM-2: each item of a Service with an active questionnaire must carry valid answers to that version; otherwise the error data carries the scheduleSlotId and fieldErrors (question id to message), or formChanged when the version is no longer active. The answers are stored as a Form Submission against the Booking Item. Accepted versions are stored against the Booking.",
			tags: ["Bookings"],
		})
		.input(CreateBookingSchema)
		.output(BookingSchema),

	listOwn: oc
		.route({
			method: "GET",
			path: "/bookings",
			summary: "My Transactions (list own bookings)",
			description:
				"Lists all bookings owned by the signed-in client, newest first, with summary status (Pending, Paid, or Cancelled). Requires bookings.own:read (BKG-4).",
			tags: ["Bookings"],
		})
		.output(MyBookingsResponseSchema),

	getOwn: oc
		.route({
			method: "GET",
			path: "/bookings/{bookingId}/details",
			summary: "Read own booking details",
			description:
				"Reads one booking owned by the signed-in client, including each item's processing status, payment details, e-Receipt, and issued documents. Returns 404 when missing or owned by another client. Requires bookings.own:read (BKG-4).",
			tags: ["Bookings"],
		})
		.input(BookingIdParamSchema)
		.output(BookingDetailSchema),

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

	form: oc
		.route({
			method: "GET",
			path: "/bookings/form",
			summary: "The questionnaire to answer when booking a service",
			description:
				"The Service's published and enabled Form Template version with its questions in order, or null when the Service has none (FRM-2). Requires bookings.own:create.",
			tags: ["Bookings"],
		})
		.input(BookingFormRequestSchema)
		.output(BookingFormSchema.nullable()),

	uploadFormFile: oc
		.route({
			method: "POST",
			path: "/bookings/form-uploads",
			summary: "Upload a file answer",
			description:
				"Stores a PDF, JPG or PNG of at most 5 MB in private storage and returns its fileKey, which the answer to a file question holds (FRM-2). The file's content must match its type. Requires bookings.own:create.",
			tags: ["Bookings"],
		})
		.input(FormUploadInputSchema)
		.output(FormUploadSchema),

	updateItemForm: oc
		.route({
			method: "PUT",
			path: "/bookings/{bookingId}/items/{bookingItemId}/form",
			summary: "Change your answers before paying",
			description:
				"Replaces the answers stored for one item of the caller's own Booking, checked against the Service's active questionnaire (FRM-2). Refused with 409 once the Booking is no longer pending_payment: after payment, corrections are made by BOQ staff during Assessment. Requires bookings.own:create.",
			tags: ["Bookings"],
		})
		.input(UpdateBookingItemFormSchema)
		.output(FormSubmissionSchema),

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

	rescheduleItem: oc
		.route({
			method: "POST",
			path: "/bookings/{bookingId}/items/{bookingItemId}/reschedule",
			summary: "Reschedule one booked item to another open slot",
			description:
				"Moves a booked item within a pending_payment or paid Booking to another active, non-full Schedule Slot for the same Service and Location, enforcing booking.max_reschedules and booking.reschedule_min_hours_before (BKG-5). Requires bookings.own:reschedule.",
			tags: ["Bookings"],
		})
		.input(RescheduleBookingItemSchema)
		.output(BookingSchema),
}