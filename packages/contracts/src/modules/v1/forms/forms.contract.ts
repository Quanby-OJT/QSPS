import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	DeleteFormTemplateResultSchema,
	FormServiceIdParamSchema,
	FormServiceSummarySchema,
	FormTemplateIdParamSchema,
	FormTemplateSchema,
	FormTemplateSummarySchema,
	SaveFormFieldsSchema,
	SetFormTemplateActiveSchema,
} from "./forms.schema.js"

/**
 * Form Template management (FRM-1). Every route needs
 * `forms.templates:manage` and works inside the caller's Scope by Service
 * Category.
 */
export const formsContract = {
	listServices: oc
		.route({
			method: "GET",
			path: "/forms/services",
			summary: "List services with their questionnaires",
			description:
				"Services in the caller's Scope, each with its published and draft questionnaire version, if any.",
			tags: ["Forms"],
		})
		.output(z.array(FormServiceSummarySchema)),
	listVersions: oc
		.route({
			method: "GET",
			path: "/forms/services/{serviceId}/templates",
			summary: "List a service's questionnaire versions",
			description:
				"Every version of the service's questionnaire, newest first, with field and submission counts.",
			tags: ["Forms"],
		})
		.input(FormServiceIdParamSchema)
		.output(z.array(FormTemplateSummarySchema)),
	get: oc
		.route({
			method: "GET",
			path: "/forms/templates/{templateId}",
			summary: "Read a questionnaire version",
			tags: ["Forms"],
		})
		.input(FormTemplateIdParamSchema)
		.output(FormTemplateSchema),
	createDraft: oc
		.route({
			method: "POST",
			path: "/forms/services/{serviceId}/draft",
			summary: "Start a draft",
			description:
				"Returns the service's draft, creating it when there is none: a new version that starts with the published questions, or empty.",
			tags: ["Forms"],
		})
		.input(FormServiceIdParamSchema)
		.output(FormTemplateSchema),
	saveFields: oc
		.route({
			method: "PUT",
			path: "/forms/templates/{templateId}/fields",
			summary: "Save a questionnaire's questions",
			description:
				"Replaces the questions of a draft, in the order sent. Editing a published version creates the next version as a draft instead, so earlier submissions keep their own version.",
			tags: ["Forms"],
		})
		.input(SaveFormFieldsSchema)
		.output(FormTemplateSchema),
	publish: oc
		.route({
			method: "POST",
			path: "/forms/templates/{templateId}/publish",
			summary: "Publish a draft",
			description:
				"Makes the draft the service's active questionnaire. The previously published version is retired and kept.",
			tags: ["Forms"],
		})
		.input(FormTemplateIdParamSchema)
		.output(FormTemplateSchema),
	setActive: oc
		.route({
			method: "PATCH",
			path: "/forms/templates/{templateId}/active",
			summary: "Disable or enable a questionnaire version",
			tags: ["Forms"],
		})
		.input(SetFormTemplateActiveSchema)
		.output(FormTemplateSummarySchema),
	delete: oc
		.route({
			method: "DELETE",
			path: "/forms/templates/{templateId}",
			summary: "Delete a questionnaire version",
			description:
				"Removes a version that has no submissions. One with submissions is refused with 409; disable it instead.",
			tags: ["Forms"],
		})
		.input(FormTemplateIdParamSchema)
		.output(DeleteFormTemplateResultSchema),
}
