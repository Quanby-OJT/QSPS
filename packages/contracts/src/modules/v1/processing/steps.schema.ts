import { z } from "zod"

import { FormAnswersSchema } from "../forms/form-answers.js"
import { FormFieldInputSchema, FormFieldSchema, MAX_FORM_FIELDS } from "../forms/forms.schema.js"

/**
 * Service Steps (PRC-4, PRD assumption A3): ordered stations a Booking Item
 * passes through, such as Laboratory, X-ray or Physician evaluation, each
 * recording a result through its own form before the item can be cleared.
 */

/** What a Form Template is for (PRC-4). Same list as FormTemplatePurpose in @repo/db. */
export const FORM_TEMPLATE_PURPOSES = ["questionnaire", "step_result"] as const
export const FormTemplatePurposeSchema = z.enum(FORM_TEMPLATE_PURPOSES)

/** Most active steps one Service may have. */
export const MAX_SERVICE_STEPS = 20
/** Longest step name, in characters. */
export const MAX_STEP_NAME_LENGTH = 100

const dateField = z.union([z.date(), z.string()]).transform(value => new Date(value))

/**
 * A step's result questions. Same rules as a questionnaire's, except that
 * staff upload no files at a station, so there are no file questions, and a
 * step needs at least one question.
 */
export const StepFieldsInputSchema = z
	.array(FormFieldInputSchema)
	.min(1, "Add at least one question for the result")
	.max(MAX_FORM_FIELDS)
	.superRefine((fields, ctx) => {
		fields.forEach((field, index) => {
			if (field.type === "file") {
				ctx.addIssue({
					code: "custom",
					path: [index, "type"],
					message: "Step results cannot have file questions",
				})
			}
		})
	})

/** One step as the configuration screen sends it, in order. `id` is null for a new step. */
export const ServiceStepInputSchema = z.object({
	id: z.number().int().positive().nullable(),
	name: z.string().trim().min(1, "Enter a step name").max(MAX_STEP_NAME_LENGTH),
	required: z.boolean(),
	fields: StepFieldsInputSchema,
})

export const ServiceStepsParamSchema = z.object({
	serviceId: z.coerce.number().int().positive(),
})

/**
 * Replace a Service's active steps with this ordered list. A step left out
 * is deleted, or disabled when it already has results. An empty list turns
 * steps off: the Service is assessed exactly as before.
 */
export const SaveServiceStepsSchema = ServiceStepsParamSchema.extend({
	steps: z
		.array(ServiceStepInputSchema)
		.max(MAX_SERVICE_STEPS, `Use at most ${MAX_SERVICE_STEPS} steps`),
}).superRefine((input, ctx) => {
	const names = input.steps.map(step => step.name.trim().toLowerCase())
	names.forEach((name, index) => {
		if (names.indexOf(name) !== index) {
			ctx.addIssue({
				code: "custom",
				path: ["steps", index, "name"],
				message: "Each step needs a different name",
			})
		}
	})
	const ids = input.steps.map(step => step.id).filter((id): id is number => id !== null)
	if (new Set(ids).size !== ids.length) {
		ctx.addIssue({ code: "custom", path: ["steps"], message: "A step is listed twice" })
	}
})

/** One configured step with its current result form. */
export const ServiceStepSchema = z.object({
	id: z.number().int().positive(),
	name: z.string(),
	position: z.number().int().min(0),
	required: z.boolean(),
	/** The published result form: its id and version, and its questions in order. */
	formTemplateId: z.number().int().positive(),
	formVersion: z.number().int().positive(),
	fields: z.array(FormFieldSchema),
	/** Results were recorded at this step, so removing it only disables it. */
	hasResults: z.boolean(),
})

export const ServiceStepsSchema = z.object({
	serviceId: z.number().int().positive(),
	serviceName: z.string(),
	/** Active steps, in order. */
	steps: z.array(ServiceStepSchema),
})

/** One recorded version of a step's result. */
export const StepResultSchema = z.object({
	id: z.number().int().positive(),
	/** 1 for the first result, 2, 3… for each correction. */
	version: z.number().int().positive(),
	formTemplateId: z.number().int().positive(),
	/** Question label to answer, in question order, as staff read it. */
	answers: z.record(z.string(), z.string()),
	/** The stored answers keyed by question id, to start a correction from. */
	values: FormAnswersSchema,
	recordedBy: z.object({ id: z.string(), name: z.string() }),
	recordedAt: dateField,
})

export const ITEM_STEP_STATUSES = ["pending", "done"] as const
export const ItemStepStatusSchema = z.enum(ITEM_STEP_STATUSES)

/** One step of a Booking Item on the assessment screen. */
export const ItemStepSchema = z.object({
	stepId: z.number().int().positive(),
	name: z.string(),
	position: z.number().int().min(0),
	required: z.boolean(),
	/** A disabled step shows its earlier results but takes no new ones and is not required. */
	isActive: z.boolean(),
	status: ItemStepStatusSchema,
	/** The form to record or correct the result with; null for a disabled step. */
	form: z
		.object({
			formTemplateId: z.number().int().positive(),
			version: z.number().int().positive(),
			fields: z.array(FormFieldSchema),
		})
		.nullable(),
	/** The current result (highest version), or null when none is recorded. */
	result: StepResultSchema.nullable(),
	/** Earlier versions, newest first. Kept when a result is corrected. */
	history: z.array(StepResultSchema),
})

/** Record a step's result, or correct it (the next version). Answers are for `formTemplateId`. */
export const RecordStepResultSchema = z.object({
	bookingItemId: z.coerce.number().int().positive(),
	stepId: z.coerce.number().int().positive(),
	formTemplateId: z.number().int().positive(),
	answers: FormAnswersSchema,
})

export type FormTemplatePurpose = z.infer<typeof FormTemplatePurposeSchema>
export type ServiceStepInput = z.infer<typeof ServiceStepInputSchema>
export type ServiceStepsParam = z.infer<typeof ServiceStepsParamSchema>
export type SaveServiceStepsInput = z.infer<typeof SaveServiceStepsSchema>
export type ServiceStep = z.infer<typeof ServiceStepSchema>
export type ServiceSteps = z.infer<typeof ServiceStepsSchema>
export type StepResult = z.infer<typeof StepResultSchema>
export type ItemStepStatus = z.infer<typeof ItemStepStatusSchema>
export type ItemStep = z.infer<typeof ItemStepSchema>
export type RecordStepResultInput = z.infer<typeof RecordStepResultSchema>
