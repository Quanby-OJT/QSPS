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

/**
 * FRM-2: a Booking Item's answers for the Assessment screen, keyed by the
 * question label of the exact version answered, in question order. Empty
 * when the item has no Form Submission.
 */
export async function readableAnswers(
	executor: FormExecutor,
	bookingItemId: number
): Promise<Record<string, string>> {
	const [submission] = await executor
		.select({ formTemplateId: formSubmissions.formTemplateId, answers: formSubmissions.answers })
		.from(formSubmissions)
		.where(eq(formSubmissions.bookingItemId, bookingItemId))
		.limit(1)
	if (!submission) return {}

	const fields = await executor
		.select({ id: formFields.id, type: formFields.type, label: formFields.label })
		.from(formFields)
		.where(eq(formFields.formTemplateId, submission.formTemplateId))
		.orderBy(asc(formFields.position))

	const readable: Record<string, string> = {}
	for (const field of fields) {
		// Two questions may share a label; keep both.
		let label = field.label
		for (let copy = 2; label in readable; copy++) label = `${field.label} (${copy})`
		readable[label] = displayAnswer(field.type, submission.answers[String(field.id)])
	}
	return readable
}
