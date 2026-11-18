import { oc } from "@orpc/contract"

import {
	BookingItemIdParamSchema,
	CheckInResponseSchema,
	CheckInSchema,
	ProcessingItemSchema,
	ProcessingQueueRequestSchema,
	ProcessingQueueSchema,
	RecordAssessmentSchema,
} from "./processing.schema.js"

/**
 * BOQ staff assessment (PRC-1, TOR §VIII.3). Every route is limited to the
 * staff user's Location: an item elsewhere answers 404 and is audited.
 */
export const processingContract = {
	queue: oc
		.route({
			method: "GET",
			path: "/processing/queue",
			summary: "Today's processing queue",
			description:
				"Booking Items at the caller's Location for one Manila date (today by default), with client name, service, time and payment status. Needs processing.queue:read.",
			tags: ["Processing"],
		})
		.input(ProcessingQueueRequestSchema)
		.output(ProcessingQueueSchema),
	item: oc
		.route({
			method: "GET",
			path: "/processing/items/{bookingItemId}",
			summary: "Read one Booking Item for assessment",
			description:
				"The client's profile, Form Submission answers and assessment history for one Booking Item at the caller's Location. Needs processing.queue:read.",
			tags: ["Processing"],
		})
		.input(BookingItemIdParamSchema)
		.output(ProcessingItemSchema),
	checkIn: oc
		.route({
			method: "POST",
			path: "/processing/check-in",
			summary: "Check a client in by Reference Number",
			description:
				"Moves the Booking's items at the caller's Location from booked to checked_in. Refused with 'Payment required' unless the Booking is paid (Annex B). Needs processing.assessments:perform.",
			tags: ["Processing"],
		})
		.input(CheckInSchema)
		.output(CheckInResponseSchema),
	open: oc
		.route({
			method: "POST",
			path: "/processing/items/{bookingItemId}/open",
			summary: "Start assessing a Booking Item",
			description:
				"Moves a checked_in or returned item to in_assessment. Needs processing.assessments:perform.",
			tags: ["Processing"],
		})
		.input(BookingItemIdParamSchema)
		.output(ProcessingItemSchema),
	assess: oc
		.route({
			method: "POST",
			path: "/processing/items/{bookingItemId}/assessments",
			summary: "Record an assessment",
			description:
				"Adds an Assessment (cleared, returned or rejected, with notes and corrections) and moves the item accordingly. A cleared item whose Service requires approval goes to pending_head_approval. Needs processing.assessments:perform.",
			tags: ["Processing"],
		})
		.input(RecordAssessmentSchema)
		.output(ProcessingItemSchema),
}
