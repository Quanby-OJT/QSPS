import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	CreatePolicyDocumentSchema,
	PolicyDocumentKeyParamSchema,
	PolicyDocumentSchema,
	PolicyDocumentSummarySchema,
	UpdatePolicyDocumentSchema,
} from "./policy-documents.schema.js"

/** ADM-9: written policies clients read, and may have to accept, at booking. */
export const policyDocumentsContract = {
	list: oc
		.route({
			method: "GET",
			path: "/policy-documents",
			summary: "List written policies",
			description:
				"The newest version of every written policy, withdrawn ones included. Requires settings.policies:manage.",
			tags: ["Policy documents"],
		})
		.output(z.array(PolicyDocumentSchema)),

	create: oc
		.route({
			method: "POST",
			path: "/policy-documents",
			summary: "Publish a written policy",
			description:
				"Stores version 1 with its Services, effective date and whether acceptance is required, and audits it. Requires settings.policies:manage.",
			tags: ["Policy documents"],
		})
		.input(CreatePolicyDocumentSchema)
		.output(PolicyDocumentSchema),

	update: oc
		.route({
			method: "PUT",
			path: "/policy-documents/{documentKey}",
			summary: "Publish a new version of a written policy",
			description:
				"Stores the next version; earlier versions and their acceptances are kept. Audited. Requires settings.policies:manage.",
			tags: ["Policy documents"],
		})
		.input(UpdatePolicyDocumentSchema)
		.output(PolicyDocumentSchema),

	withdraw: oc
		.route({
			method: "POST",
			path: "/policy-documents/{documentKey}/withdraw",
			summary: "Withdraw a written policy",
			description:
				"Stops every version of the policy from applying to new bookings. Earlier acceptances are kept. Audited. Requires settings.policies:manage.",
			tags: ["Policy documents"],
		})
		.input(PolicyDocumentKeyParamSchema)
		.output(PolicyDocumentSchema),

	published: oc
		.route({
			method: "GET",
			path: "/policy-documents/published",
			summary: "Policies in effect",
			description:
				"Public, no session. The version of each written policy that applies today, for the public policies page. Rate limited.",
			tags: ["Policy documents"],
		})
		.output(z.array(PolicyDocumentSummarySchema)),
}
