import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, count, eq, inArray, max } from "drizzle-orm"

import type {
	FormFieldInput,
	SaveServiceStepsInput,
	ServiceStep,
	ServiceSteps,
} from "@repo/contracts"
import { formFields, formTemplates, serviceSteps, services, stepResults } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { denyOutsideScope } from "@/common/scope/scope-denial"
import { inScope, NATIONWIDE_SCOPE, type ResolvedScope } from "@/common/scope/scope-match"

import { fieldsByTemplate, publishedStepForms, type StepExecutor } from "./item-steps"

// Same domain as the other Service settings (ADM-1).
const AUDIT_DOMAIN_SERVICES = "services"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The question list compared and stored: shape only. */
function fieldShape(fields: readonly FormFieldInput[]) {
	return fields.map(field => ({
		type: field.type,
		label: field.label,
		required: field.required,
		options: field.options ?? null,
	}))
}

function sameFields(a: readonly FormFieldInput[], b: readonly FormFieldInput[]): boolean {
	return JSON.stringify(fieldShape(a)) === JSON.stringify(fieldShape(b))
}

/**
 * PRC-4: a Service's ordered steps and their result forms, configured on the
 * Service by holders of `settings.services:manage` within their Scope.
 *
 * Each step's result form is a `form_templates` row with
 * `purpose = step_result`. It has no draft: saving changed questions
 * publishes the next version and retires the previous one, which stays for
 * the results recorded against it. A step left out of the list is deleted,
 * or only disabled when it already has results.
 */
@Injectable()
export class ServiceStepsService {
	constructor(private readonly auditService: AuditService) {}

	async list(
		serviceId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ServiceSteps> {
		const service = await this.requireService(db, serviceId, actorId, scope)
		return { serviceId, serviceName: service.name, steps: await this.activeSteps(db, serviceId) }
	}

	async save(
		input: SaveServiceStepsInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE,
		now: Date = new Date()
	): Promise<ServiceSteps> {
		return db.transaction(async tx => {
			// Locked so two admins saving the same Service's steps take turns.
			const service = await this.requireService(tx, input.serviceId, actorId, scope, true)
			const before = await this.activeSteps(tx, input.serviceId)

			const existing = await tx
				.select({ id: serviceSteps.id, isActive: serviceSteps.isActive })
				.from(serviceSteps)
				.where(eq(serviceSteps.serviceId, input.serviceId))
			const known = new Set(existing.map(step => step.id))
			const unknown = input.steps.find(step => step.id !== null && !known.has(step.id))
			if (unknown) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Step "${unknown.name}" does not belong to this service. Reload the page and try again.`,
				})
			}

			// Steps taken out of the list: delete, or disable when they have results.
			const kept = new Set(input.steps.map(step => step.id).filter(id => id !== null))
			const removed = existing.filter(step => step.isActive && !kept.has(step.id))
			for (const step of removed) await this.removeStep(tx, step.id, now)

			const forms = await publishedStepForms(
				tx,
				input.steps.map(step => step.id).filter((id): id is number => id !== null)
			)
			const currentFields = await fieldsByTemplate(
				tx,
				[...forms.values()].map(form => form.formTemplateId)
			)

			for (const [position, step] of input.steps.entries()) {
				if (step.id === null) {
					const [created] = await tx
						.insert(serviceSteps)
						.values({
							serviceId: input.serviceId,
							name: step.name,
							position,
							required: step.required,
							isActive: true,
							createdAt: now,
							updatedAt: now,
						})
						.returning({ id: serviceSteps.id })
					if (!created) {
						throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The step could not be saved" })
					}
					await this.publishForm(tx, input.serviceId, created.id, step.fields, now)
					continue
				}

				await tx
					.update(serviceSteps)
					.set({
						name: step.name,
						position,
						required: step.required,
						isActive: true,
						updatedAt: now,
					})
					.where(eq(serviceSteps.id, step.id))
				const form = forms.get(step.id)
				const fields = form ? (currentFields.get(form.formTemplateId) ?? []) : []
				if (!form || !sameFields(fields, step.fields)) {
					await this.publishForm(tx, input.serviceId, step.id, step.fields, now)
				}
			}

			const after = await this.activeSteps(tx, input.serviceId)
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SERVICES,
					action: "service_steps.update",
					actorId,
					targetType: "service",
					targetId: String(input.serviceId),
					oldValue: { steps: before.map(auditStep) },
					newValue: { steps: after.map(auditStep), removedStepIds: removed.map(step => step.id) },
				},
				tx
			)
			return { serviceId: input.serviceId, serviceName: service.name, steps: after }
		})
	}

	/** Delete a step with no results, with its forms; disable one that has results. */
	private async removeStep(tx: Transaction, stepId: number, now: Date): Promise<void> {
		const [results] = await tx
			.select({ total: count() })
			.from(stepResults)
			.where(eq(stepResults.serviceStepId, stepId))
		if ((results?.total ?? 0) > 0) {
			await tx
				.update(serviceSteps)
				.set({ isActive: false, updatedAt: now })
				.where(eq(serviceSteps.id, stepId))
			return
		}
		// form_fields go with their template (on delete cascade).
		await tx.delete(formTemplates).where(eq(formTemplates.serviceStepId, stepId))
		await tx.delete(serviceSteps).where(eq(serviceSteps.id, stepId))
	}

	/** Publish the next version of a step's result form and retire the current one. */
	private async publishForm(
		tx: Transaction,
		serviceId: number,
		stepId: number,
		fields: readonly FormFieldInput[],
		now: Date
	): Promise<void> {
		const [latest] = await tx
			.select({ version: max(formTemplates.version) })
			.from(formTemplates)
			.where(eq(formTemplates.serviceStepId, stepId))
		await tx
			.update(formTemplates)
			.set({ status: "retired", updatedAt: now })
			.where(and(eq(formTemplates.serviceStepId, stepId), eq(formTemplates.status, "published")))
		const [template] = await tx
			.insert(formTemplates)
			.values({
				serviceId,
				purpose: "step_result",
				serviceStepId: stepId,
				version: (latest?.version ?? 0) + 1,
				status: "published",
				isActive: true,
				publishedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning({ id: formTemplates.id })
		if (!template) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "The result form could not be saved",
			})
		}
		if (fields.length > 0) {
			await tx.insert(formFields).values(
				fields.map((field, position) => ({
					formTemplateId: template.id,
					type: field.type,
					label: field.label,
					required: field.required,
					options: field.options ?? null,
					position,
				}))
			)
		}
	}

	/** The Service's active steps, in order, each with its published result form. */
	private async activeSteps(executor: StepExecutor, serviceId: number): Promise<ServiceStep[]> {
		const steps = await executor
			.select({
				id: serviceSteps.id,
				name: serviceSteps.name,
				position: serviceSteps.position,
				required: serviceSteps.required,
			})
			.from(serviceSteps)
			.where(and(eq(serviceSteps.serviceId, serviceId), eq(serviceSteps.isActive, true)))
			.orderBy(asc(serviceSteps.position), asc(serviceSteps.id))
		if (steps.length === 0) return []

		const ids = steps.map(step => step.id)
		const forms = await publishedStepForms(executor, ids)
		const fields = await fieldsByTemplate(
			executor,
			[...forms.values()].map(form => form.formTemplateId)
		)
		const withResults = await executor
			.selectDistinct({ serviceStepId: stepResults.serviceStepId })
			.from(stepResults)
			.where(inArray(stepResults.serviceStepId, ids))
		const used = new Set(withResults.map(row => row.serviceStepId))

		return steps.flatMap(step => {
			const form = forms.get(step.id)
			// Every saved step has a published form; skip one left without (never expected).
			if (!form) return []
			return [
				{
					id: step.id,
					name: step.name,
					position: step.position,
					required: step.required,
					formTemplateId: form.formTemplateId,
					formVersion: form.version,
					fields: fields.get(form.formTemplateId) ?? [],
					hasResults: used.has(step.id),
				},
			]
		})
	}

	/** ADM-2: a Service outside the caller's Scope answers like a missing one. */
	private async requireService(
		executor: StepExecutor,
		serviceId: number,
		actorId: string | null,
		scope: ResolvedScope,
		lock = false
	): Promise<{ name: string }> {
		const notFound = `Service "${serviceId}" was not found`
		const query = executor
			.select({ name: services.name, serviceCategoryId: services.serviceCategoryId })
			.from(services)
			.where(eq(services.id, serviceId))
		const [service] = lock ? await query.for("update") : await query.limit(1)
		if (!service) throw new ORPCError("NOT_FOUND", { message: notFound })
		if (!inScope(scope, { serviceCategoryId: service.serviceCategoryId })) {
			await denyOutsideScope(
				this.auditService,
				actorId,
				{ type: "service", id: serviceId, notFoundMessage: notFound },
				{ serviceCategoryId: service.serviceCategoryId }
			)
		}
		return { name: service.name }
	}
}

/** What the audit log keeps of a step. */
function auditStep(step: ServiceStep) {
	return {
		id: step.id,
		name: step.name,
		position: step.position,
		required: step.required,
		formVersion: step.formVersion,
		fields: step.fields.map(field => ({
			type: field.type,
			label: field.label,
			required: field.required,
			options: field.options,
		})),
	}
}
