import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	CreateServiceSchema,
	ServiceCategorySchema,
	ServiceSchema,
	SetServiceActiveRequestSchema,
	UpdateServiceRequestSchema,
} from "./services.schema.js"

export const servicesContract = {
	listCategories: oc
		.route({
			method: "GET",
			path: "/services/categories",
			summary: "List service categories",
			description: "List the seeded BOQ service categories.",
			tags: ["Services"],
		})
		.output(z.array(ServiceCategorySchema)),

	list: oc
		.route({
			method: "GET",
			path: "/services",
			summary: "List services for administration",
			description:
				"List all services, including disabled services. Requires service management permission.",
			tags: ["Services"],
		})
		.output(z.array(ServiceSchema)),

	listAvailable: oc
		.route({
			method: "GET",
			path: "/services/available",
			summary: "List active services",
			description: "List active services available to signed-in clients.",
			tags: ["Services"],
		})
		.output(z.array(ServiceSchema)),

	create: oc
		.route({
			method: "POST",
			path: "/services",
			summary: "Create a service",
			tags: ["Services"],
		})
		.input(CreateServiceSchema)
		.output(ServiceSchema),

	update: oc
		.route({
			method: "PUT",
			path: "/services/{id}",
			summary: "Update a service",
			tags: ["Services"],
		})
		.input(UpdateServiceRequestSchema)
		.output(ServiceSchema),

	setActive: oc
		.route({
			method: "PUT",
			path: "/services/{id}/active",
			summary: "Enable or disable a service",
			tags: ["Services"],
		})
		.input(SetServiceActiveRequestSchema)
		.output(ServiceSchema),
}
