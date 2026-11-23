import { asc, eq } from "drizzle-orm"

import type { FormFieldType } from "@repo/contracts"
import { formFields, formSubmissions } from "@repo/db/schema"

import type { FormExecutor } from "./form-submissions.token"

/** One stored answer as staff read it, or "Not answered". */
export function displayAnswer(type: FormFieldType, value: unknown): string {
	if (value === undefined || value === null || value === "") return "Not answered"
	if (type === "file") return "File attached"
	if (typeof value === "boolean") return value ? "Yes" : "No"
	if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(", ") : "Not answered"
	return String(value)
}

/** FRM-2c: an answered file question, by id and the label it has in `readableAnswers`. */
export interface FileAnswer {
	fieldId: number
	label: string
}

interface LabelledAnswer {
	fieldId: number
	type: FormFieldType
	label: string
	value: unknown
}

/**
 * Each question of the exact version answered, in question order, with a
 * unique label (a repeated label gets " (2)", " (3)") and the stored answer.
 * Empty when the item has no Form Submission.
 */
async function labelledAnswers(
	executor: FormExecutor,
	bookingItemId: number
): Promise<LabelledAnswer[]> {
	const [submission] = await executor
		.select({ formTemplateId: formSubmissions.formTemplateId, answers: formSubmissions.answers })
		.from(formSubmissions)
		.where(eq(formSubmissions.bookingItemId, bookingItemId))
		.limit(1)
	if (!submission) return []

	const fields = await executor
		.select({ id: formFields.id, type: formFields.type, label: formFields.label })
		.from(formFields)
		.where(eq(formFields.formTemplateId, submission.formTemplateId))
		.orderBy(asc(formFields.position))

	const used = new Set<string>()
	return fields.map(field => {
		// Two questions may share a label; keep both.
		let label = field.label
		for (let copy = 2; used.has(label); copy++) label = `${field.label} (${copy})`
		used.add(label)
		return {
			fieldId: field.id,
			type: field.type,
			label,
			value: submission.answers[String(field.id)],
		}
	})
}

/**
 * FRM-2: a Booking Item's answers for the Assessment screen, keyed by the
 * question label of the exact version answered, in question order. Empty
 * when the item has no Form Submission.
 */
export async function readableAnswers(
	executor: FormExecutor,
	bookingItemId: number
): Promise<Record<string, string>> {
	const readable: Record<string, string> = {}
	for (const answer of await labelledAnswers(executor, bookingItemId)) {
		readable[answer.label] = displayAnswer(answer.type, answer.value)
	}
	return readable
}

/**
 * FRM-2c: the file questions that have an answer, with the same labels as
 * `readableAnswers`, so the Assessment screen can offer a download for each.
 */
export async function fileAnswers(
	executor: FormExecutor,
	bookingItemId: number
): Promise<FileAnswer[]> {
	return (await labelledAnswers(executor, bookingItemId))
		.filter(
			answer => answer.type === "file" && typeof answer.value === "string" && answer.value !== ""
		)
		.map(answer => ({ fieldId: answer.fieldId, label: answer.label }))
}
