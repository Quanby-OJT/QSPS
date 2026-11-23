import { describe, expect, it } from "vitest"

import {
	checkFormAnswers,
	FORM_UPLOAD_KEY_PATTERN,
	FormAnswersSchema,
	type CheckedField,
} from "./form-answers.js"

const fields: CheckedField[] = [
	{ id: 1, type: "text", required: true, options: null },
	{ id: 2, type: "number", required: false, options: null },
	{ id: 3, type: "date", required: false, options: null },
	{ id: 4, type: "single_choice", required: true, options: ["Work", "Leisure"] },
	{ id: 5, type: "multiple_choice", required: false, options: ["A", "B", "C"] },
	{ id: 6, type: "yes_no", required: true, options: null },
	{ id: 7, type: "file", required: false, options: null },
]

const FILE_KEY = "form-uploads/user_1/0b6f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b.pdf"

describe("checkFormAnswers", () => {
	it("accepts valid answers, trims text and drops unknown questions", () => {
		const result = checkFormAnswers(fields, {
			"1": "  Juan Dela Cruz ",
			"2": 3,
			"3": "2026-12-01",
			"4": "Work",
			"5": ["A", "C", "A"],
			"6": false,
			"7": FILE_KEY,
			"99": "not a question",
		})
		expect(result).toEqual({
			ok: true,
			answers: {
				"1": "Juan Dela Cruz",
				"2": 3,
				"3": "2026-12-01",
				"4": "Work",
				"5": ["A", "C"],
				"6": false,
				"7": FILE_KEY,
			},
		})
	})

	it("flags every required question left empty", () => {
		const result = checkFormAnswers(fields, { "1": "   ", "5": [] })
		expect(result).toEqual({
			ok: false,
			fieldErrors: {
				"1": "This question is required",
				"4": "This question is required",
				"6": "This question is required",
			},
		})
	})

	it("flags answers of the wrong type", () => {
		const result = checkFormAnswers(fields, {
			"1": 12,
			"2": "12",
			"3": "2026-02-30",
			"4": "Other",
			"5": ["Z"],
			"6": "yes",
			"7": "../secrets.pdf",
		})
		expect(result).toEqual({
			ok: false,
			fieldErrors: {
				"1": "Enter text",
				"2": "Enter a number",
				"3": "Enter a valid date",
				"4": "Choose one of the options",
				"5": "Choose from the options",
				"6": "Choose yes or no",
				"7": "Upload a file",
			},
		})
	})

	it("leaves blank optional answers out", () => {
		const result = checkFormAnswers(fields, { "1": "Ana", "4": "Leisure", "6": true, "2": null })
		expect(result).toEqual({ ok: true, answers: { "1": "Ana", "4": "Leisure", "6": true } })
	})

	it("refuses text over the limit", () => {
		const result = checkFormAnswers([fields[0] as CheckedField], { "1": "x".repeat(1001) })
		expect(result.ok).toBe(false)
	})
})

describe("FormAnswersSchema", () => {
	it("needs question ids as keys", () => {
		expect(FormAnswersSchema.safeParse({ name: "Ana" }).success).toBe(false)
		expect(FormAnswersSchema.safeParse({ "12": "Ana" }).success).toBe(true)
	})
})

describe("FORM_UPLOAD_KEY_PATTERN", () => {
	it("accepts only keys inside a user folder with an allowed extension", () => {
		expect(FORM_UPLOAD_KEY_PATTERN.test(FILE_KEY)).toBe(true)
		expect(FORM_UPLOAD_KEY_PATTERN.test("form-uploads/../x.pdf")).toBe(false)
		expect(FORM_UPLOAD_KEY_PATTERN.test(FILE_KEY.replace(".pdf", ".exe"))).toBe(false)
	})
})
