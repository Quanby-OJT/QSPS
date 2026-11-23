import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm"

import type {
	FormFieldInput,
	FormServiceSummary,
	FormTemplate,
	FormTemplateSummary,
} from "@repo/contracts"
import { formFields, formSubmissions, formTemplates, services } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { denyOutsideScope } from "@/common/scope/scope-denial"
import {
	inScope,
	NATIONWIDE_SCOPE,
	scopeCondition,
	type ResolvedScope,
} from "@/common/scope/scope-match"

const AUDIT_DOMAIN_FORMS = "forms"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Transaction
type TemplateRow = typeof formTemplates.$inferSelect
type FieldRow = typeof formFields.$inferSelect

/** What the audit log keeps of a question list: shape only, no answers. */
function auditFields(fields: readonly Pick<FieldRow, "type" | "label" | "required" | "options">[]) {
	return fields.map(field => ({
		type: field.type,
		label: field.label,
		required: field.required,
		options: field.options,
	}))
}

/**
 * Form Templates (FRM-1): the questionnaire a client answers for a Service.
 *
 * Each row in `form_templates` is one version. A Service has at most one
 * draft and one published version; publishing retires the previous
 * published version but keeps it, so earlier Form Submissions still display
 * against the questions they answered. Published versions are never edited
 * in place: saving questions on one creates the next version as a draft.
 * Every method works inside the caller's Scope by Service Category (ADM-2).
 */
@Injectable()
export class FormsService {
	constructor(private readonly auditService: AuditService) {}

	/** Services in Scope, each with its published and draft version, if any. */
	async listServices(scope: ResolvedScope = NATIONWIDE_SCOPE): Promise<FormServiceSummary[]> {
		const serviceRows = await db
			.select({ id: services.id, code: services.code, name: services.name })
			.from(services)
			.where(scopeCondition(scope, { serviceCategoryId: services.serviceCategoryId }))
			.orderBy(asc(services.name))
		if (serviceRows.length === 0) return []

		const versions = await db
			.select({
				id: formTemplates.id,
				serviceId: formTemplates.serviceId,
				version: formTemplates.version,
				status: formTemplates.status,
				isActive: formTemplates.isActive,
			})
			.from(formTemplates)
			.where(
				and(
					inArray(
						formTemplates.serviceId,
						serviceRows.map(row => row.id)
					),
					inArray(formTemplates.status, ["draft", "published"])
				)
			)

		return serviceRows.map(service => {
			const published = versions.find(v => v.serviceId === service.id && v.status === "published")
			const draft = versions.find(v => v.serviceId === service.id && v.status === "draft")
			return {
				serviceId: service.id,
				serviceCode: service.code,
				serviceName: service.name,
				published: published
					? { templateId: published.id, version: published.version, isActive: published.isActive }
					: null,
				draft: draft ? { templateId: draft.id, version: draft.version } : null,
			}
		})
	}

	/** Every version of a Service's questionnaire, newest first. */
	async listVersions(
		serviceId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<FormTemplateSummary[]> {
		await this.requireService(db, serviceId, actorId, scope)
		const rows = await db
			.select()
			.from(formTemplates)
			.where(eq(formTemplates.serviceId, serviceId))
			.orderBy(desc(formTemplates.version))
		return Promise.all(rows.map(row => this.summarize(db, row)))
	}

	/** One version with its questions. */
	async get(
		templateId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<FormTemplate> {
		const template = await this.requireTemplate(db, templateId, actorId, scope)
		return this.withFields(db, template)
	}

	/**
	 * The Service's draft. Created when there is none, as the next version,
	 * starting from the published questions (or empty). Calling it again
	 * returns the same draft.
	 */
	async createDraft(
		serviceId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<FormTemplate> {
		return db.transaction(async tx => {
			await this.requireService(tx, serviceId, actorId, scope, true)

			const [existing] = await tx
				.select()
				.from(formTemplates)
				.where(and(eq(formTemplates.serviceId, serviceId), eq(formTemplates.status, "draft")))
				.limit(1)
			if (existing) return this.withFields(tx, existing)

			const [published] = await tx
				.select()
				.from(formTemplates)
				.where(and(eq(formTemplates.serviceId, serviceId), eq(formTemplates.status, "published")))
				.limit(1)
			const startingFields = published ? await this.fieldsOf(tx, published.id) : []

			const draft = await this.insertDraft(
				tx,
				serviceId,
				startingFields,
				actorId,
				published ?? null
			)
			return this.withFields(tx, draft)
		})
	}

	/**
	 * Save the question list, in the order given (positions follow the list).
	 *
	 * - Draft: its questions are replaced.
	 * - Published: a new version is created as a draft with these questions;
	 *   the published version and its submissions are untouched.
	 * - Retired: refused.
	 */
	async saveFields(
		templateId: number,
		fields: readonly FormFieldInput[],
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<FormTemplate> {
		return db.transaction(async tx => {
			const template = await this.requireTemplate(tx, templateId, actorId, scope, true)

			if (template.status === "retired") {
				throw new ORPCError("CONFLICT", {
					message: `Version ${template.version} is retired and cannot be edited`,
				})
			}

			if (template.status === "published") {
				const [draft] = await tx
					.select({ version: formTemplates.version })
					.from(formTemplates)
					.where(
						and(eq(formTemplates.serviceId, template.serviceId), eq(formTemplates.status, "draft"))
					)
					.limit(1)
				if (draft) {
					throw new ORPCError("CONFLICT", {
						message: `Version ${draft.version} is already a draft for this service. Edit that draft instead.`,
					})
				}
				const created = await this.insertDraft(tx, template.serviceId, fields, actorId, template)
				return this.withFields(tx, created)
			}

			const before = await this.fieldsOf(tx, template.id)
			await tx.delete(formFields).where(eq(formFields.formTemplateId, template.id))
			await this.insertFields(tx, template.id, fields)
			const [updated] = await tx
				.update(formTemplates)
				.set({ updatedAt: new Date() })
				.where(eq(formTemplates.id, template.id))
				.returning()

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_FORMS,
					action: "form_template.fields.update",
					actorId,
					targetType: "form_template",
					targetId: String(template.id),
					oldValue: { fields: auditFields(before) },
					newValue: { fields: auditFields(fields) },
				},
				tx
			)
			return this.withFields(tx, updated ?? template)
		})
	}

	/**
	 * Make a draft the Service's active questionnaire. The previously
	 * published version is retired and kept.
	 */
	async publish(
		templateId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<FormTemplate> {
		return db.transaction(async tx => {
			const template = await this.requireTemplate(tx, templateId, actorId, scope, true)
			if (template.status !== "draft") {
				throw new ORPCError("CONFLICT", { message: "Only a draft can be published" })
			}
			const fields = await this.fieldsOf(tx, template.id)
			if (fields.length === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Add at least one question before publishing",
				})
			}

			const now = new Date()
			const retired = await tx
				.update(formTemplates)
				.set({ status: "retired", updatedAt: now })
				.where(
					and(
						eq(formTemplates.serviceId, template.serviceId),
						eq(formTemplates.status, "published")
					)
				)
				.returning({ id: formTemplates.id, version: formTemplates.version })

			const [published] = await tx
				.update(formTemplates)
				.set({ status: "published", isActive: true, publishedAt: now, updatedAt: now })
				.where(eq(formTemplates.id, template.id))
				.returning()

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_FORMS,
					action: "form_template.publish",
					actorId,
					targetType: "form_template",
					targetId: String(template.id),
					oldValue: {
						status: "draft",
						retiredVersions: retired.map(row => row.version),
					},
					newValue: {
						status: "published",
						serviceId: template.serviceId,
						version: template.version,
					},
				},
				tx
			)
			return this.withFields(tx, published ?? template)
		})
	}

	/** Disable or re-enable a published or retired version. A draft has nothing to disable. */
	async setActive(
		templateId: number,
		isActive: boolean,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<FormTemplateSummary> {
		return db.transaction(async tx => {
			const template = await this.requireTemplate(tx, templateId, actorId, scope, true)
			if (template.status === "draft") {
				throw new ORPCError("CONFLICT", {
					message: "Publish the draft before enabling or disabling it",
				})
			}
			if (template.isActive === isActive) return this.summarize(tx, template)

			const [updated] = await tx
				.update(formTemplates)
				.set({ isActive, updatedAt: new Date() })
				.where(eq(formTemplates.id, template.id))
				.returning()

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_FORMS,
					action: isActive ? "form_template.enable" : "form_template.disable",
					actorId,
					targetType: "form_template",
					targetId: String(template.id),
					oldValue: { isActive: template.isActive },
					newValue: { isActive },
				},
				tx
			)
			return this.summarize(tx, updated ?? template)
		})
	}

	/**
	 * Delete a version that nobody has answered. One with submissions is
	 * refused with 409: its answers must keep their questions, so disable it
	 * instead.
	 */
	async delete(
		templateId: number,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<{ deleted: true }> {
		return db.transaction(async tx => {
			const template = await this.requireTemplate(tx, templateId, actorId, scope, true)

			const submissionCount = await this.submissionCount(tx, template.id)
			if (submissionCount > 0) {
				throw new ORPCError("CONFLICT", {
					message: `This form has ${submissionCount} submission${submissionCount === 1 ? "" : "s"} and cannot be deleted. Disable it instead.`,
					data: { submissionCount, canDisable: template.status !== "draft" },
				})
			}

			const fields = await this.fieldsOf(tx, template.id)
			await tx.delete(formTemplates).where(eq(formTemplates.id, template.id))

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_FORMS,
					action: "form_template.delete",
					actorId,
					targetType: "form_template",
					targetId: String(template.id),
					oldValue: {
						serviceId: template.serviceId,
						version: template.version,
						status: template.status,
						fields: auditFields(fields),
					},
					newValue: null,
				},
				tx
			)
			return { deleted: true as const }
		})
	}

	// ------------------------------------------------------------------------

	private async insertDraft(
		tx: Transaction,
		serviceId: number,
		fields: readonly FormFieldInput[],
		actorId: string | null,
		from: TemplateRow | null
	): Promise<TemplateRow> {
		const [latest] = await tx
			.select({ version: max(formTemplates.version) })
			.from(formTemplates)
			.where(eq(formTemplates.serviceId, serviceId))
		const version = (latest?.version ?? 0) + 1

		const [draft] = await tx
			.insert(formTemplates)
			.values({ serviceId, version, status: "draft", isActive: true })
			.returning()
		if (!draft) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The draft could not be created" })
		}
		await this.insertFields(tx, draft.id, fields)

		await this.auditService.record(
			{
				domain: AUDIT_DOMAIN_FORMS,
				action: "form_template.version.create",
				actorId,
				targetType: "form_template",
				targetId: String(draft.id),
				oldValue: from ? { fromTemplateId: from.id, fromVersion: from.version } : null,
				newValue: { serviceId, version, status: "draft", fields: auditFields(fields) },
			},
			tx
		)
		return draft
	}

	private async insertFields(
		tx: Transaction,
		templateId: number,
		fields: readonly FormFieldInput[]
	): Promise<void> {
		if (fields.length === 0) return
		await tx.insert(formFields).values(
			fields.map((field, position) => ({
				formTemplateId: templateId,
				type: field.type,
				label: field.label,
				required: field.required,
				options:
					field.type === "single_choice" || field.type === "multiple_choice" ? field.options : null,
				position,
			}))
		)
	}

	private async fieldsOf(executor: Executor, templateId: number): Promise<FieldRow[]> {
		return executor
			.select()
			.from(formFields)
			.where(eq(formFields.formTemplateId, templateId))
			.orderBy(asc(formFields.position))
	}

	private async submissionCount(executor: Executor, templateId: number): Promise<number> {
		const [row] = await executor
			.select({ total: count() })
			.from(formSubmissions)
			.where(eq(formSubmissions.formTemplateId, templateId))
		return Number(row?.total ?? 0)
	}

	private async summarize(executor: Executor, row: TemplateRow): Promise<FormTemplateSummary> {
		const [fields] = await executor
			.select({ total: count() })
			.from(formFields)
			.where(eq(formFields.formTemplateId, row.id))
		return {
			id: row.id,
			serviceId: row.serviceId,
			version: row.version,
			status: row.status,
			isActive: row.isActive,
			fieldCount: Number(fields?.total ?? 0),
			submissionCount: await this.submissionCount(executor, row.id),
			publishedAt: row.publishedAt,
			updatedAt: row.updatedAt,
		}
	}

	private async withFields(executor: Executor, row: TemplateRow): Promise<FormTemplate> {
		const fields = await this.fieldsOf(executor, row.id)
		const summary = await this.summarize(executor, row)
		return {
			...summary,
			fieldCount: fields.length,
			fields: fields.map(field => ({
				id: field.id,
				type: field.type,
				label: field.label,
				required: field.required,
				options: field.options ?? null,
				position: field.position,
			})),
		}
	}

	/** The Service, checked against Scope. Outside Scope answers like a missing one. */
	private async requireService(
		executor: Executor,
		serviceId: number,
		actorId: string | null,
		scope: ResolvedScope,
		lock = false
	): Promise<{ id: number; serviceCategoryId: number }> {
		const query = executor
			.select({ id: services.id, serviceCategoryId: services.serviceCategoryId })
			.from(services)
			.where(eq(services.id, serviceId))
		const [service] = lock ? await query.for("update") : await query.limit(1)
		if (!service) {
			throw new ORPCError("NOT_FOUND", { message: `Service "${serviceId}" was not found` })
		}
		if (!inScope(scope, { serviceCategoryId: service.serviceCategoryId })) {
			await denyOutsideScope(
				this.auditService,
				actorId,
				{ type: "service", id: serviceId, notFoundMessage: `Service "${serviceId}" was not found` },
				{ serviceCategoryId: service.serviceCategoryId }
			)
		}
		return service
	}

	/**
	 * The version, checked against its Service's Scope. Writes lock the
	 * Service row so two admins cannot create or publish versions at once.
	 */
	private async requireTemplate(
		executor: Executor,
		templateId: number,
		actorId: string | null,
		scope: ResolvedScope,
		lock = false
	): Promise<TemplateRow> {
		const [template] = await executor
			.select()
			.from(formTemplates)
			.where(eq(formTemplates.id, templateId))
			.limit(1)
		if (!template) {
			throw new ORPCError("NOT_FOUND", { message: `Form template "${templateId}" was not found` })
		}
		const notFound = `Form template "${templateId}" was not found`
		const query = executor
			.select({ serviceCategoryId: services.serviceCategoryId })
			.from(services)
			.where(eq(services.id, template.serviceId))
		const [service] = lock ? await query.for("update") : await query.limit(1)
		if (!service || !inScope(scope, { serviceCategoryId: service.serviceCategoryId })) {
			await denyOutsideScope(
				this.auditService,
				actorId,
				{ type: "form_template", id: templateId, notFoundMessage: notFound },
				service ? { serviceCategoryId: service.serviceCategoryId } : undefined
			)
		}
		return template
	}
}
