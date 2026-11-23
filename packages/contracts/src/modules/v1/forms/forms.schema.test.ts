import { describe, expect, it } from "vitest"

import { FormFieldInputSchema, FormFieldsInputSchema, MAX_FORM_FIELDS } from "./forms.schema.js"

const text = {
	type: "text",
	label: "Full name on passport",
	required: true,
	options: null,
} as const

describe("form field schema", () => {
	it("accepts every supported type", () => {
		for (const type of ["text", "number", "date", "yes_no", "file"] as const) {
			expect(FormFieldInputSchema.safeParse({ ...text, type }).success).toBe(true)
		}
		for (const type of ["single_choice", "multiple_choice"] as const) {
			expect(
				FormFieldInputSchema.safeParse({ ...text, type, options: ["Yes", "No"] }).success
			).toBe(true)
		}
	})

	it("rejects an unknown type and an empty label", () => {
		expect(FormFieldInputSchema.safeParse({ ...text, type: "signature" }).success).toBe(false)
		expect(FormFieldInputSchema.safeParse({ ...text, label: "   " }).success).toBe(false)
	})

	it("needs at least two different options on a choice question", () => {
		const choice = { ...text, type: "single_choice" as const }
		expect(FormFieldInputSchema.safeParse({ ...choice, options: null }).success).toBe(false)
		expect(FormFieldInputSchema.safeParse({ ...choice, options: ["Only one"] }).success).toBe(false)
		expect(FormFieldInputSchema.safeParse({ ...choice, options: ["Yes", "yes"] }).success).toBe(
			false
		)
		expect(FormFieldInputSchema.safeParse({ ...choice, options: ["Yes", ""] }).success).toBe(false)
	})

	it("refuses options on a question that is not a choice", () => {
		expect(FormFieldInputSchema.safeParse({ ...text, options: ["A", "B"] }).success).toBe(false)
		expect(FormFieldInputSchema.safeParse({ ...text, options: [] }).success).toBe(true)
	})

	it("limits a form to the maximum number of questions", () => {
		expect(FormFieldsInputSchema.safeParse(Array(MAX_FORM_FIELDS).fill(text)).success).toBe(true)
		expect(FormFieldsInputSchema.safeParse(Array(MAX_FORM_FIELDS + 1).fill(text)).success).toBe(
			false
		)
	})
})
