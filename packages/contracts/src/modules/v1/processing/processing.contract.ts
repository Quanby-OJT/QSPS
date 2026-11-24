import { oc } from "@orpc/contract"

import {
	ApprovalQueueRequestSchema,
	ApprovalQueueSchema,
	BookingItemIdParamSchema,
	CheckInResponseSchema,
	CheckInSchema,
	DecideApprovalSchema,
	OverrideItemSchema,
	ProcessingItemSchema,
	ProcessingQueueRequestSchema,
	ProcessingQueueSchema,
	RecordAssessmentSchema,
} from "./processing.schema.js"
import {
	RecordStepResultSchema,
	SaveServiceStepsSchema,
	ServiceStepsParamSchema,
	ServiceStepsSchema,
} from "./steps.schema.js"

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
	approvals: oc
		.route({
			method: "GET",
			path: "/processing/approvals",
			summary: "Items waiting for head approval",
			description:
				"PRC-3: Booking Items in pending_head_approval (view=pending), or rejected items an approver may override (view=rejected), inside the caller's Scope. Needs processing.assessments:approve.",
			tags: ["Processing"],
		})
		.input(ApprovalQueueRequestSchema)
		.output(ApprovalQueueSchema),
	decide: oc
		.route({
			method: "POST",
			path: "/processing/items/{bookingItemId}/approval",
			summary: "Approve or send back a pending item",
			description:
				"PRC-3: approve moves pending_head_approval to cleared; return sends it back to in_assessment with notes. Refused with 403 when the caller performed the clearing Assessment. Needs processing.assessments:approve.",
			tags: ["Processing"],
		})
		.input(DecideApprovalSchema)
		.output(ProcessingItemSchema),
	override: oc
		.route({
			method: "POST",
			path: "/processing/items/{bookingItemId}/override",
			summary: "Override a rejected item to cleared",
			description:
				"PRC-3: clears a rejected item with a mandatory reason; audited with the before and after state. Needs processing.assessments:approve.",
			tags: ["Processing"],
		})
		.input(OverrideItemSchema)
		.output(ProcessingItemSchema),
	recordStepResult: oc
		.route({
			method: "POST",
			path: "/processing/items/{bookingItemId}/steps/{stepId}/results",
			summary: "Record or correct a step's result",
			description:
				"PRC-4: records the result of one Service Step through the step's result form while the item is in_assessment. Recording again corrects it: the next version is added, the earlier one is kept, and the correction is audited. Needs processing.assessments:perform at the item's station.",
			tags: ["Processing"],
		})
		.input(RecordStepResultSchema)
		.output(ProcessingItemSchema),
	serviceSteps: oc
		.route({
			method: "GET",
			path: "/services/{serviceId}/steps",
			summary: "Read a Service's steps",
			description:
				"PRC-4: the ordered steps a Service's Booking Items pass through, each with its result form. Needs settings.services:manage within the caller's Scope.",
			tags: ["Services"],
		})
		.input(ServiceStepsParamSchema)
		.output(ServiceStepsSchema),
	saveServiceSteps: oc
		.route({
			method: "PUT",
			path: "/services/{serviceId}/steps",
			summary: "Configure a Service's steps",
			description:
				"PRC-4: replaces the Service's active steps with this ordered list. Changed result questions publish the next form version; a removed step is deleted, or disabled when it has results. An empty list turns steps off. Needs settings.services:manage within the caller's Scope.",
			tags: ["Services"],
		})
		.input(SaveServiceStepsSchema)
		.output(ServiceStepsSchema),
}
