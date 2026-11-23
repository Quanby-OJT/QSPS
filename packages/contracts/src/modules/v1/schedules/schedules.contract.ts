import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	BlockScheduleDateRequestSchema,
	BlockScheduleDateResponseSchema,
	BulkUpdateCapacityRequestSchema,
	BulkUpdateCapacityResponseSchema,
	DeleteSlotResponseSchema,
	GenerateSlotsResponseSchema,
	GenerateSlotsSchema,
	ListSlotsRequestSchema,
	ScheduleSlotSchema,
	SetSlotDisabledRequestSchema,
	SlotAvailabilitySchema,
	SlotIdParamSchema,
	UnblockScheduleDateRequestSchema,
	UnblockScheduleDateResponseSchema,
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

	bulkUpdateCapacity: oc
		.route({
			method: "PUT",
			path: "/schedules/slots/capacity/bulk",
			summary: "Bulk update schedule capacity",
			description:
				"Update capacity across one day, week, or month. Slots whose booked count exceeds the requested capacity are returned unchanged.",
			tags: ["Schedules"],
		})
		.input(BulkUpdateCapacityRequestSchema)
		.output(BulkUpdateCapacityResponseSchema),

	blockDate: oc
		.route({
			method: "POST",
			path: "/schedules/dates/block",
			summary: "Block a schedule date",
			description:
				"Disable all slots for a service and location on a Manila date, returning paid bookings for follow-up.",
			tags: ["Schedules"],
		})
		.input(BlockScheduleDateRequestSchema)
		.output(BlockScheduleDateResponseSchema),

	unblockDate: oc
		.route({
			method: "POST",
			path: "/schedules/dates/unblock",
			summary: "Unblock a schedule date",
			tags: ["Schedules"],
		})
		.input(UnblockScheduleDateRequestSchema)
		.output(UnblockScheduleDateResponseSchema),

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
