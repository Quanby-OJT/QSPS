import { and, asc, desc, eq, inArray, or } from "drizzle-orm"

import type { FormAnswers, FormField, ItemStep, StepResult } from "@repo/contracts"
import {
	bookingItems,
	formFields,
	formTemplates,
	serviceSteps,
	stepResults,
	users,
} from "@repo/db/schema"

import type { db } from "@/common/database/database.client"
import { displayAnswer } from "@/modules/v1/forms/form-answers-display"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
/** The database, or the transaction a caller is in. */
export type StepExecutor = typeof db | Transaction

type StepRow = Pick<
	typeof serviceSteps.$inferSelect,
	"id" | "name" | "position" | "required" | "isActive"
>

/** A Form Field as the contracts describe it. */
function toField(row: typeof formFields.$inferSelect): FormField {
	return {
		id: row.id,
		type: row.type,
		label: row.label,
		required: row.required,
		options: row.options ?? null,
		position: row.position,
	}
}

/**
 * Each question's answer as staff read it, keyed by question label in
 * question order. A repeated label gets " (2)", " (3)", as on the
 * questionnaire answers (FRM-2).
 */
export function readableStepAnswers(
	fields: readonly FormField[],
	answers: Readonly<Record<string, unknown>>
): Record<string, string> {
	const readable: Record<string, string> = {}
	for (const field of fields) {
		let label = field.label
		for (let copy = 2; Object.hasOwn(readable, label); copy++) label = `${field.label} (${copy})`
		readable[label] = displayAnswer(field.type, answers[String(field.id)])
	}
	return readable
}

/** The questions of each form version, in order, keyed by template id. */
export async function fieldsByTemplate(
	executor: StepExecutor,
	templateIds: readonly number[]
): Promise<Map<number, FormField[]>> {
	const byTemplate = new Map<number, FormField[]>()
	if (templateIds.length === 0) return byTemplate
	const rows = await executor
		.select()
		.from(formFields)
		.where(inArray(formFields.formTemplateId, [...new Set(templateIds)]))
		.orderBy(asc(formFields.formTemplateId), asc(formFields.position))
	for (const row of rows) {
		const list = byTemplate.get(row.formTemplateId) ?? []
		list.push(toField(row))
		byTemplate.set(row.formTemplateId, list)
	}
	return byTemplate
}

/** The published result form of each step, keyed by step id. */
export async function publishedStepForms(
	executor: StepExecutor,
	stepIds: readonly number[]
): Promise<Map<number, { formTemplateId: number; version: number }>> {
	const forms = new Map<number, { formTemplateId: number; version: number }>()
	if (stepIds.length === 0) return forms
	const rows = await executor
		.select({
			id: formTemplates.id,
			serviceStepId: formTemplates.serviceStepId,
			version: formTemplates.version,
		})
		.from(formTemplates)
		.where(
			and(
				inArray(formTemplates.serviceStepId, [...stepIds]),
				eq(formTemplates.purpose, "step_result"),
				eq(formTemplates.status, "published")
			)
		)
	for (const row of rows) {
		if (row.serviceStepId !== null) {
			forms.set(row.serviceStepId, { formTemplateId: row.id, version: row.version })
		}
	}
	return forms
}

/**
 * PRC-4: a Booking Item's steps for the assessment screen, in order. Lists
 * the Service's active steps, plus any disabled step this item already has
 * results for, each with its status, its current result and the earlier
 * versions. Empty when the Service has no steps, so the screen is as before.
 */
export async function itemSteps(
	executor: StepExecutor,
	bookingItemId: number,
	serviceId: number
): Promise<ItemStep[]> {
	const results = await executor
		.select({
			id: stepResults.id,
			serviceStepId: stepResults.serviceStepId,
			formTemplateId: stepResults.formTemplateId,
			version: stepResults.version,
			answers: stepResults.answers,
			recordedById: stepResults.recordedBy,
			recordedByName: users.name,
			createdAt: stepResults.createdAt,
		})
		.from(stepResults)
		.innerJoin(users, eq(users.id, stepResults.recordedBy))
		.where(eq(stepResults.bookingItemId, bookingItemId))
		.orderBy(desc(stepResults.version))

	const stepIdsWithResults = [...new Set(results.map(result => result.serviceStepId))]
	const steps: StepRow[] = await executor
		.select({
			id: serviceSteps.id,
			name: serviceSteps.name,
			position: serviceSteps.position,
			required: serviceSteps.required,
			isActive: serviceSteps.isActive,
		})
		.from(serviceSteps)
		.where(
			and(
				eq(serviceSteps.serviceId, serviceId),
				stepIdsWithResults.length > 0
					? or(eq(serviceSteps.isActive, true), inArray(serviceSteps.id, stepIdsWithResults))
					: eq(serviceSteps.isActive, true)
			)
		)
		.orderBy(asc(serviceSteps.position), asc(serviceSteps.id))
	if (steps.length === 0) return []

	const forms = await publishedStepForms(
		executor,
		steps.filter(step => step.isActive).map(step => step.id)
	)
	const fields = await fieldsByTemplate(executor, [
		...[...forms.values()].map(form => form.formTemplateId),
		...results.map(result => result.formTemplateId),
	])

	// Disabled steps come after the active ones, which keep their configured order.
	const ordered = [...steps.filter(step => step.isActive), ...steps.filter(step => !step.isActive)]
	return ordered.map((step): ItemStep => {
		const versions: StepResult[] = results
			.filter(result => result.serviceStepId === step.id)
			.map(result => ({
				id: result.id,
				version: result.version,
				formTemplateId: result.formTemplateId,
				answers: readableStepAnswers(fields.get(result.formTemplateId) ?? [], result.answers),
				values: result.answers as FormAnswers,
				recordedBy: { id: result.recordedById, name: result.recordedByName },
				recordedAt: result.createdAt,
			}))
		const form = step.isActive ? forms.get(step.id) : undefined
		return {
			stepId: step.id,
			name: step.name,
			position: step.position,
			required: step.isActive && step.required,
			isActive: step.isActive,
			status: versions.length > 0 ? "done" : "pending",
			form: form
				? {
						formTemplateId: form.formTemplateId,
						version: form.version,
						fields: fields.get(form.formTemplateId) ?? [],
					}
				: null,
			result: versions[0] ?? null,
			history: versions.slice(1),
		}
	})
}

/**
 * PRC-4: the names of the item's Service's active required steps that have
 * no result for this item yet, in order. Empty when the item may be cleared,
 * including when the Service has no steps.
 */
export async function missingRequiredSteps(
	executor: StepExecutor,
	bookingItemId: number
): Promise<string[]> {
	const required = await executor
		.select({ id: serviceSteps.id, name: serviceSteps.name })
		.from(serviceSteps)
		.innerJoin(bookingItems, eq(bookingItems.serviceId, serviceSteps.serviceId))
		.where(
			and(
				eq(bookingItems.id, bookingItemId),
				eq(serviceSteps.isActive, true),
				eq(serviceSteps.required, true)
			)
		)
		.orderBy(asc(serviceSteps.position), asc(serviceSteps.id))
	if (required.length === 0) return []

	const recorded = await executor
		.selectDistinct({ serviceStepId: stepResults.serviceStepId })
		.from(stepResults)
		.where(
			and(
				eq(stepResults.bookingItemId, bookingItemId),
				inArray(
					stepResults.serviceStepId,
					required.map(step => step.id)
				)
			)
		)
	const done = new Set(recorded.map(row => row.serviceStepId))
	return required.filter(step => !done.has(step.id)).map(step => step.name)
}
