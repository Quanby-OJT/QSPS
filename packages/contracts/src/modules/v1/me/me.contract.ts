import { oc } from "@orpc/contract"

import { ClientProfileSchema, MePermissionsSchema, UpdateClientProfileSchema } from "./me.schema.js"

export const meContract = {
	permissions: oc
		.route({
			method: "GET",
			path: "/me/permissions",
			summary: "Get current user permissions",
			description: "Return the current user's role names and effective permission names.",
			tags: ["Me"],
		})
		.output(MePermissionsSchema),

	profile: oc
		.route({
			method: "GET",
			path: "/me/profile",
			summary: "Get my profile",
			description: "Return the signed-in user's profile and whether it is complete.",
			tags: ["Me"],
		})
		.output(ClientProfileSchema),

	updateProfile: oc
		.route({
			method: "PUT",
			path: "/me/profile",
			summary: "Complete or update my profile",
			description:
				"Save name, mobile, birth date, nationality and gender. The first complete save opens the portal. Requires `account.profile:manage`.",
			tags: ["Me"],
		})
		.input(UpdateClientProfileSchema)
		.output(ClientProfileSchema),
}
