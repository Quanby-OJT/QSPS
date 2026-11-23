import { describe, expect, it } from "vitest"

import type { FormField } from "@repo/contracts"

import {
	blankField,
	isDirty,
	moveField,
	parseOptions,
	toDraftFields,
	toFieldInputs,
	validateFields,
} from "./form-builder"

const saved: FormField[] = [
	{ id: 1, type: "text", label: "Full name", required: true, options: null, position: 0 },
	{
		id: 2,
		type: "single_choice",
		label: "Purpose of travel",
		required: false,
		options: ["Work", "Leisure"],
		position: 1,
	},
]

describe("form builder helpers", () => {
	it("round-trips saved questions without marking them changed", () => {
		const draft = toDraftFields(saved)
		expect(isDirty(saved, draft)).toBe(false)
		expect(toFieldInputs(draft)).toEqual([
			{ type: "text", label: "Full name", required: true, options: null },
			{
				type: "single_choice",
				label: "Purpose of travel",
				required: false,
				options: ["Work", "Leisure"],
			},
		])
	})

	it("marks a reorder as a change", () => {
		const draft = moveField(toDraftFields(saved), 1, -1)
		expect(draft.map(field => field.label)).toEqual(["Purpose of travel", "Full name"])
		expect(isDirty(saved, draft)).toBe(true)
	})

	it("ignores moves past either end", () => {
		expect(moveField([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
		expect(moveField([1, 2, 3], 2, 1)).toEqual([1, 2, 3])
		expect(moveField([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
	})

	it("reads one option per line and drops blank lines", () => {
		expect(parseOptions(" Work \n\nLeisure\n")).toEqual(["Work", "Leisure"])
	})

	it("only choice questions send options", () => {
		const field = { ...blankField("yes_no"), label: "Vaccinated before?", optionsText: "ignored" }
		expect(toFieldInputs([field])[0]?.options).toBeNull()
	})

	it("points at the question to fix", () => {
		const fields = [
			{ ...blankField("text"), label: "Full name" },
			{ ...blankField("multiple_choice"), label: "Symptoms", optionsText: "Fever" },
		]
		expect(validateFields(fields)).toEqual({
			ok: false,
			index: 1,
			message: "Question 2: Add at least two options",
		})
	})

	it("refuses a question with no label", () => {
		expect(validateFields([blankField("date")])).toMatchObject({ ok: false, index: 0 })
	})

	it("accepts every question type", () => {
		const fields = (
			["text", "number", "date", "single_choice", "multiple_choice", "yes_no", "file"] as const
		).map(type => ({ ...blankField(type), label: `A ${type} question` }))
		expect(validateFields(fields).ok).toBe(true)
	})
})
