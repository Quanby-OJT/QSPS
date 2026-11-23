import {
	CHOICE_FIELD_TYPES,
	FormFieldsInputSchema,
	type FormField,
	type FormFieldInput,
	type FormFieldType,
} from "@repo/contracts"

/** Labels the builder shows for each question type. */
export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
	text: "Text",
	number: "Number",
	date: "Date",
	single_choice: "Single choice",
	multiple_choice: "Multiple choice",
	yes_no: "Yes / No",
	file: "File upload",
}

/** A question while it is being edited. `key` keeps React rows stable while reordering. */
export type DraftField = {
	key: string
	type: FormFieldType
	label: string
	required: boolean
	/** One option per line, as typed. */
	optionsText: string
}

let nextKey = 0
function newKey(): string {
	nextKey += 1
	return `field-${nextKey}`
}

export function isChoiceType(type: FormFieldType): boolean {
	return CHOICE_FIELD_TYPES.includes(type)
}

export function blankField(type: FormFieldType = "text"): DraftField {
	return {
		key: newKey(),
		type,
		label: "",
		required: false,
		optionsText: isChoiceType(type) ? "Option 1\nOption 2" : "",
	}
}

export function toDraftFields(fields: readonly FormField[]): DraftField[] {
	return fields.map(field => ({
		key: newKey(),
		type: field.type,
		label: field.label,
		required: field.required,
		optionsText: (field.options ?? []).join("\n"),
	}))
}

export function parseOptions(text: string): string[] {
	return text
		.split("\n")
		.map(option => option.trim())
		.filter(option => option.length > 0)
}

export function toFieldInputs(fields: readonly DraftField[]): FormFieldInput[] {
	return fields.map(field => ({
		type: field.type,
		label: field.label.trim(),
		required: field.required,
		options: isChoiceType(field.type) ? parseOptions(field.optionsText) : null,
	}))
}

/** Move the question at `index` up (-1) or down (+1). Out-of-range moves change nothing. */
export function moveField<T>(fields: readonly T[], index: number, direction: -1 | 1): T[] {
	const target = index + direction
	if (index < 0 || index >= fields.length || target < 0 || target >= fields.length) {
		return [...fields]
	}
	const next = [...fields]
	const [moved] = next.splice(index, 1)
	next.splice(target, 0, moved as T)
	return next
}

export type ValidationResult =
	| { ok: true; fields: FormFieldInput[] }
	| { ok: false; message: string; index: number | null }

/** The same rules the API applies, so the builder can point at the question to fix. */
export function validateFields(fields: readonly DraftField[]): ValidationResult {
	const inputs = toFieldInputs(fields)
	const parsed = FormFieldsInputSchema.safeParse(inputs)
	if (parsed.success) return { ok: true, fields: parsed.data }
	const issue = parsed.error.issues[0]
	const index = typeof issue?.path[0] === "number" ? issue.path[0] : null
	const message = issue?.message ?? "Check the questions"
	return {
		ok: false,
		index,
		message: index === null ? message : `Question ${index + 1}: ${message}`,
	}
}

/** Whether the edited list differs from what is saved. */
export function isDirty(saved: readonly FormField[], draft: readonly DraftField[]): boolean {
	const a = JSON.stringify(
		saved.map(field => ({
			type: field.type,
			label: field.label,
			required: field.required,
			options: field.options ?? null,
		}))
	)
	const b = JSON.stringify(toFieldInputs(draft))
	return a !== b
}
