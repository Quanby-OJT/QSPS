import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	DeleteSlotResponseSchema,
	GenerateSlotsResponseSchema,
	GenerateSlotsSchema,
	ListSlotsRequestSchema,
	ScheduleSlotSchema,
	SetSlotDisabledRequestSchema,
	SlotAvailabilitySchema,
	SlotIdParamSchema,
	UpdateSlotCapacityRequestSchema,
} from "./schedules.schema.js"

export const schedulesContract = {
	listSlots: oc
		.route({
			method: "GET",
			path: "/schedules/slots",
			summary: "List schedule slots for administration",
			description:
				"List every slot for a service at a location in one Asia/Manila month, including disabled slots. Requires schedule management permission.",
			tags: ["Schedules"],
		})
		.input(ListSlotsRequestSchema)
		.output(z.array(ScheduleSlotSchema)),

	listAvailability: oc
		.route({
			method: "GET",
			path: "/schedules/availability",
			summary: "List slot availability",
			description:
				"List each slot's remaining capacity for a service at a location in one Asia/Manila month. Full, disabled and already-started slots are marked unavailable. Available to signed-in users.",
			tags: ["Schedules"],
		})
		.input(ListSlotsRequestSchema)
		.output(z.array(SlotAvailabilitySchema)),

	generateSlots: oc
		.route({
			method: "POST",
			path: "/schedules/slots/generate",
			summary: "Generate schedule slots",
			description:
				"Create one slot per date and time window in a date range. Slots that already exist are skipped.",
			tags: ["Schedules"],
		})
		.input(GenerateSlotsSchema)
		.output(GenerateSlotsResponseSchema),

	updateSlotCapacity: oc
		.route({
			method: "PUT",
			path: "/schedules/slots/{id}",
			summary: "Change a slot's capacity",
			description: "Capacity cannot be set below the number of bookings already made.",
			tags: ["Schedules"],
		})
		.input(UpdateSlotCapacityRequestSchema)
		.output(ScheduleSlotSchema),

	setSlotDisabled: oc
		.route({
			method: "PUT",
			path: "/schedules/slots/{id}/disabled",
			summary: "Disable or re-enable a slot",
			description: "A disabled slot takes no new bookings; existing bookings remain.",
			tags: ["Schedules"],
		})
		.input(SetSlotDisabledRequestSchema)
		.output(ScheduleSlotSchema),

	deleteSlot: oc
		.route({
			method: "DELETE",
			path: "/schedules/slots/{id}",
			summary: "Delete a slot",
			description: "A slot with bookings cannot be deleted; disable it instead.",
			tags: ["Schedules"],
		})
		.input(SlotIdParamSchema)
		.output(DeleteSlotResponseSchema),
}
