import { oc } from "@orpc/contract"
import { z } from "zod"

import { PolicySchema, UpdatePolicyRequestSchema } from "./policies.schema.js"

export const policiesContract = {
	list: oc
		.route({
			method: "GET",
			path: "/policies",
			summary: "List booking, payment and sign-in policies",
			description:
				"Every registered Policy with its current value and default. Requires settings.policies:manage.",
			tags: ["Policies"],
		})
		.output(z.array(PolicySchema)),

	update: oc
		.route({
			method: "PUT",
			path: "/policies",
			summary: "Change one policy value",
			description:
				"Validates the value against the key's type and range, stores it, and audits the old and new value. Requires settings.policies:manage.",
			tags: ["Policies"],
		})
		.input(UpdatePolicyRequestSchema)
		.output(PolicySchema),
}
