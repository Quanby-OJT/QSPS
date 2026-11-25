import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq } from "drizzle-orm"

import { checkFormAnswers, type BookingForm } from "@repo/contracts"
import { formFields, formTemplates } from "@repo/db/schema"

import { db } from "@/common/database/database.client"

import type {
	FormExecutor,
	FormSubmissionPreparer,
	PreparedSubmission,
	PrepareSubmissionArgs,
} from "./form-submissions.token"
import { FormUploadService } from "./form-uploads.service"

function refuse(
	serviceName: string,
	data: Record<string, unknown>,
	fieldErrors: Record<string, string>
): never {
	throw new ORPCError("BAD_REQUEST", {
		message: `Some answers for ${serviceName} need fixing.`,
		data: { ...data, fieldErrors },
	})
}

/**
 * Answers to a Service's questionnaire (FRM-2).
 *
 * The active version is the Service's `published` version while it is
 * enabled. Answers are checked against that version with the same rules the
 * web uses (`checkFormAnswers`), and a file answer must be one of the
 * caller's own stored uploads. FRM-2b: a pending upload is confirmed (copied
 * out of `pending/`) when the answers are prepared, and the prepared answers
 * hold the confirmed key.
 */
@Injectable()
export class FormSubmissionService implements FormSubmissionPreparer {
	constructor(private readonly uploads: FormUploadService) {}

	/** For the booking wizard: the Service's active questionnaire, or null. */
	async forService(serviceId: number): Promise<BookingForm | null> {
		return this.activeForm(db, serviceId)
	}

	/**
	 * The active version with its questions in order. `lock` takes a share
	 * lock on the version row, so it cannot be retired or disabled until the
	 * booking that answered it commits.
	 */
	async activeForm(
		executor: FormExecutor,
		serviceId: number,
		lock = false
	): Promise<BookingForm | null> {
		const query = executor
			.select({ id: formTemplates.id, version: formTemplates.version })
			.from(formTemplates)
			.where(
				and(
					eq(formTemplates.serviceId, serviceId),
					eq(formTemplates.status, "published"),
					eq(formTemplates.isActive, true),
					// PRC-4: a Service Step's result form is never the client's questionnaire.
					eq(formTemplates.purpose, "questionnaire")
				)
			)
		const [template] = lock ? await query.for("share") : await query.limit(1)
		if (!template) return null

		const fields = await executor
			.select()
			.from(formFields)
			.where(eq(formFields.formTemplateId, template.id))
			.orderBy(asc(formFields.position))
		return {
			serviceId,
			formTemplateId: template.id,
			version: template.version,
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

	/**
	 * Check one item's answers. Returns null when the Service has no active
	 * questionnaire (anything sent is ignored). Refuses with 400 when the
	 * answers are for another version (`formChanged`), or when any answer is
	 * missing or of the wrong type (`fieldErrors`, question id to message).
	 */
	async prepare(
		executor: FormExecutor,
		args: PrepareSubmissionArgs
	): Promise<PreparedSubmission | null> {
		const form = await this.activeForm(executor, args.serviceId, true)
		if (!form) return null
		const data = { ...args.errorData, serviceId: args.serviceId }

		if (!args.form || args.form.formTemplateId !== form.formTemplateId) {
			throw new ORPCError("BAD_REQUEST", {
				message: args.form
					? `The questionnaire for ${args.serviceName} was updated while you were booking. Please answer it again.`
					: `Please answer the questionnaire for ${args.serviceName}.`,
				data: { ...data, formChanged: true },
			})
		}

		const check = checkFormAnswers(form.fields, args.form.answers)
		if (!check.ok) refuse(args.serviceName, data, check.fieldErrors)

		const fileFields = form.fields.filter(field => field.type === "file")
		const fileErrors: Record<string, string> = {}
		for (const field of fileFields) {
			const key = String(field.id)
			const value = check.answers[key]
			if (typeof value === "string" && !(await this.uploads.ownsUpload(value, args.actorId))) {
				fileErrors[key] = "Upload this file again"
			}
		}
		if (Object.keys(fileErrors).length > 0) refuse(args.serviceName, data, fileErrors)

		// FRM-2b: only after every answer is valid, so a refused booking copies nothing.
		const answers = { ...check.answers }
		for (const field of fileFields) {
			const key = String(field.id)
			const value = answers[key]
			if (typeof value === "string") {
				answers[key] = await this.uploads.confirmUpload(value, args.actorId, executor)
			}
		}

		return { formTemplateId: form.formTemplateId, version: form.version, answers }
	}
}
