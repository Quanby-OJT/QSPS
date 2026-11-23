import { z } from "zod"

/**
 * Question types a Form Template supports (FRM-1, TOR §VIII.3). The one list
 * web, mobile and the API agree on.
 */
export const FORM_FIELD_TYPES = [
	"text",
	"number",
	"date",
	"single_choice",
	"multiple_choice",
	"yes_no",
	"file",
] as const

export const FormFieldTypeSchema = z.enum(FORM_FIELD_TYPES)

/** Types whose answer is picked from `options`. */
export const CHOICE_FIELD_TYPES: readonly FormFieldType[] = ["single_choice", "multiple_choice"]

export const FORM_TEMPLATE_STATUSES = ["draft", "published", "retired"] as const
export const FormTemplateStatusSchema = z.enum(FORM_TEMPLATE_STATUSES)

/** Most questions one form may have. */
export const MAX_FORM_FIELDS = 100
/** Most choices one question may have. */
export const MAX_FIELD_OPTIONS = 50

/**
 * One question as the builder sends it. Choice questions need at least two
 * distinct, non-empty options; every other type has none. Position comes
 * from the question's place in the list.
 */
export const FormFieldInputSchema = z
	.object({
		type: FormFieldTypeSchema,
		label: z.string().trim().min(1, "Enter a question").max(200),
		required: z.boolean(),
		options: z.array(z.string().trim().min(1, "Options cannot be empty").max(100)).nullable(),
	})
	.superRefine((field, ctx) => {
		const isChoice = CHOICE_FIELD_TYPES.includes(field.type)
		if (!isChoice) {
			if (field.options !== null && field.options.length > 0) {
				ctx.addIssue({
					code: "custom",
					path: ["options"],
					message: "Only single and multiple choice questions have options",
				})
			}
			return
		}
		const options = field.options ?? []
		if (options.length < 2) {
			ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least two options" })
		}
		if (options.length > MAX_FIELD_OPTIONS) {
			ctx.addIssue({
				code: "custom",
				path: ["options"],
				message: `Use at most ${MAX_FIELD_OPTIONS} options`,
			})
		}
		const lower = options.map(option => option.toLowerCase())
		if (new Set(lower).size !== lower.length) {
			ctx.addIssue({ code: "custom", path: ["options"], message: "Options must be different" })
		}
	})

/** The whole question list, in display order. */
export const FormFieldsInputSchema = z.array(FormFieldInputSchema).max(MAX_FORM_FIELDS)

export const FormFieldSchema = z.object({
	id: z.number().int().positive(),
	type: FormFieldTypeSchema,
	label: z.string(),
	required: z.boolean(),
	options: z.array(z.string()).nullable(),
	position: z.number().int().min(0),
})

const isoDate = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/** One version, without its questions. */
export const FormTemplateSummarySchema = z.object({
	id: z.number().int().positive(),
	serviceId: z.number().int().positive(),
	version: z.number().int().positive(),
	status: FormTemplateStatusSchema,
	isActive: z.boolean(),
	fieldCount: z.number().int().min(0),
	submissionCount: z.number().int().min(0),
	publishedAt: isoDate.nullable(),
	updatedAt: isoDate,
})

/** One version with its questions, in order. */
export const FormTemplateSchema = FormTemplateSummarySchema.extend({
	fields: z.array(FormFieldSchema),
})

/** A Service in the Forms overview: its published and draft versions, if any. */
export const FormServiceSummarySchema = z.object({
	serviceId: z.number().int().positive(),
	serviceCode: z.string(),
	serviceName: z.string(),
	published: z
		.object({
			templateId: z.number().int().positive(),
			version: z.number().int(),
			isActive: z.boolean(),
		})
		.nullable(),
	draft: z
		.object({ templateId: z.number().int().positive(), version: z.number().int() })
		.nullable(),
})

export const FormServiceIdParamSchema = z.object({ serviceId: z.coerce.number().int().positive() })
export const FormTemplateIdParamSchema = z.object({
	templateId: z.coerce.number().int().positive(),
})

export const SaveFormFieldsSchema = FormTemplateIdParamSchema.extend({
	fields: FormFieldsInputSchema,
})

export const SetFormTemplateActiveSchema = FormTemplateIdParamSchema.extend({
	isActive: z.boolean(),
})

export const DeleteFormTemplateResultSchema = z.object({ deleted: z.literal(true) })

export type FormFieldType = z.infer<typeof FormFieldTypeSchema>
export type FormTemplateStatus = z.infer<typeof FormTemplateStatusSchema>
export type FormFieldInput = z.infer<typeof FormFieldInputSchema>
export type FormField = z.infer<typeof FormFieldSchema>
export type FormTemplateSummary = z.infer<typeof FormTemplateSummarySchema>
export type FormTemplate = z.infer<typeof FormTemplateSchema>
export type FormServiceSummary = z.infer<typeof FormServiceSummarySchema>
export type SaveFormFieldsInput = z.infer<typeof SaveFormFieldsSchema>
export type SetFormTemplateActiveInput = z.infer<typeof SetFormTemplateActiveSchema>
