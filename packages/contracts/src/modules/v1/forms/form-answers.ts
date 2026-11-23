import { z } from "zod"

import { MAX_FORM_FIELDS, type FormField } from "./forms.schema.js"

/** Longest text answer, in characters (FRM-2). */
export const MAX_TEXT_ANSWER_LENGTH = 1000

/** Largest file a client may upload as an answer. */
export const FORM_UPLOAD_MAX_BYTES = 5 * 1024 * 1024

/** File types accepted as answers, with the extension each is stored under. */
export const FORM_UPLOAD_TYPES = {
	"application/pdf": "pdf",
	"image/jpeg": "jpg",
	"image/png": "png",
} as const

export type FormUploadContentType = keyof typeof FORM_UPLOAD_TYPES

export const FORM_UPLOAD_CONTENT_TYPES = Object.keys(FORM_UPLOAD_TYPES) as FormUploadContentType[]

/**
 * Where an uploaded answer is stored: the uploader's user id, then a random
 * name. The API accepts a key only under the caller's own folder.
 */
export const FORM_UPLOAD_KEY_PATTERN =
	/^form-uploads\/[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/

/** One answer as it travels: text, number, yes/no, the chosen options, a file key, or nothing. */
export const FormAnswerValueSchema = z.union([
	z.string().max(MAX_TEXT_ANSWER_LENGTH),
	z.number(),
	z.boolean(),
	z.array(z.string().max(100)).max(50),
	z.null(),
])

/** Answers keyed by question (form field) id. */
export const FormAnswersSchema = z
	.record(z.string().regex(/^\d+$/, "Answers are keyed by question id"), FormAnswerValueSchema)
	.refine(answers => Object.keys(answers).length <= MAX_FORM_FIELDS, "Too many answers")

export type FormAnswerValue = z.infer<typeof FormAnswerValueSchema>
export type FormAnswers = Record<string, FormAnswerValue>

/** The questions a check needs. */
export type CheckedField = Pick<FormField, "id" | "type" | "required" | "options">

export type AnswerCheck =
	| { ok: true; answers: FormAnswers }
	| { ok: false; fieldErrors: Record<string, string> }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A calendar date that exists, written YYYY-MM-DD. */
function isRealDate(value: string): boolean {
	if (!DATE_PATTERN.test(value)) return false
	const date = new Date(`${value}T00:00:00.000Z`)
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isBlank(value: unknown): boolean {
	return (
		value === undefined ||
		value === null ||
		(typeof value === "string" && value.trim() === "") ||
		(Array.isArray(value) && value.length === 0)
	)
}

/** The cleaned answer, or the message to show under the question. */
function checkOne(field: CheckedField, value: unknown): { value: FormAnswerValue } | string {
	const options = field.options ?? []
	switch (field.type) {
		case "text": {
			if (typeof value !== "string") return "Enter text"
			const text = value.trim()
			return text.length > MAX_TEXT_ANSWER_LENGTH
				? `Use at most ${MAX_TEXT_ANSWER_LENGTH} characters`
				: { value: text }
		}
		case "number":
			return typeof value === "number" && Number.isFinite(value) ? { value } : "Enter a number"
		case "date":
			return typeof value === "string" && isRealDate(value) ? { value } : "Enter a valid date"
		case "yes_no":
			return typeof value === "boolean" ? { value } : "Choose yes or no"
		case "single_choice":
			return typeof value === "string" && options.includes(value)
				? { value }
				: "Choose one of the options"
		case "multiple_choice":
			return Array.isArray(value) &&
				value.every(item => typeof item === "string" && options.includes(item))
				? { value: [...new Set(value as string[])] }
				: "Choose from the options"
		case "file":
			return typeof value === "string" && FORM_UPLOAD_KEY_PATTERN.test(value)
				? { value }
				: "Upload a file"
	}
}

/**
 * Check answers against one Form Template version (FRM-2). The web runs it
 * before sending, and the API runs it again on the version it stores, so
 * both flag the same questions with the same messages.
 *
 * Required questions must be answered; every answer must have its
 * question's type. Answers to questions not in this version are dropped,
 * and blank optional answers are left out.
 */
export function checkFormAnswers(
	fields: readonly CheckedField[],
	answers: Readonly<Record<string, unknown>>
): AnswerCheck {
	const clean: FormAnswers = {}
	const fieldErrors: Record<string, string> = {}
	for (const field of fields) {
		const key = String(field.id)
		const value = answers[key]
		if (isBlank(value)) {
			if (field.required) fieldErrors[key] = "This question is required"
			continue
		}
		const result = checkOne(field, value)
		if (typeof result === "string") fieldErrors[key] = result
		else clean[key] = result.value
	}
	return Object.keys(fieldErrors).length > 0
		? { ok: false, fieldErrors }
		: { ok: true, answers: clean }
}
