import { oc } from "@orpc/contract"

import { SupportContactsSchema } from "./support.schema.js"

export const supportContract = {
	contacts: oc
		.route({
			method: "GET",
			path: "/support/contacts",
			summary: "Help desk contact channels",
			description:
				"Public, no session. The help desk phone, email, ticketing link and support hours; a channel with no value is null. Changed through PUT /v1/policies. Rate limited.",
			tags: ["Support"],
		})
		.output(SupportContactsSchema),
}
