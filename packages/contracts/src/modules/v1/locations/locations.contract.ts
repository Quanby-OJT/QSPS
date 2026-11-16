import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	CreateLocationSchema,
	DeleteLocationResponseSchema,
	LocationCodeParamSchema,
	LocationSchema,
	SetLocationActiveRequestSchema,
	UpdateLocationRequestSchema,
} from "./locations.schema.js"

export const locationsContract = {
	list: oc
		.route({
			method: "GET",
			path: "/locations",
			summary: "List BOQ locations",
			description:
				"List all locations, including disabled locations. Requires location management permission.",
			tags: ["Locations"],
		})
		.output(z.array(LocationSchema)),

	listAvailable: oc
		.route({
			method: "GET",
			path: "/locations/available",
			summary: "List active BOQ locations",
			description: "List active locations available for new bookings.",
			tags: ["Locations"],
		})
		.output(z.array(LocationSchema)),

	create: oc
		.route({
			method: "POST",
			path: "/locations",
			summary: "Create BOQ location",
			tags: ["Locations"],
		})
		.input(CreateLocationSchema)
		.output(LocationSchema),

	update: oc
		.route({
			method: "PUT",
			path: "/locations/{code}",
			summary: "Update BOQ location",
			tags: ["Locations"],
		})
		.input(UpdateLocationRequestSchema)
		.output(LocationSchema),

	setActive: oc
		.route({
			method: "PUT",
			path: "/locations/{code}/active",
			summary: "Enable or disable BOQ location",
			tags: ["Locations"],
		})
		.input(SetLocationActiveRequestSchema)
		.output(LocationSchema),

	delete: oc
		.route({
			method: "DELETE",
			path: "/locations/{code}",
			summary: "Delete BOQ location",
			description: "Locations are retained; disable a location instead of deleting it.",
			tags: ["Locations"],
		})
		.input(LocationCodeParamSchema)
		.output(DeleteLocationResponseSchema),
}
