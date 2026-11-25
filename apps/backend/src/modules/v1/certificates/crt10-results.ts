import { ORPCError } from "@orpc/server"
import { and, desc, eq } from "drizzle-orm"

import {
	formFields,
	formSubmissions,
	formTemplates,
	serviceSteps,
	stepResults,
} from "@repo/db/schema"

import type { Transaction } from "../bookings/bookings.service"
import {
	parseWaterAnalysis,
	WATER_LAB_STEP,
	WATER_RESULT_FIELD,
	WATER_TESTING_SERVICE_CODE,
} from "../processing/steps/water-analysis"
import type { IssueContext, RenderableDocumentType } from "./document-types/document-type"
import {
	FOOD_EXPORT_DOCUMENT_TYPE,
	foodExportCertificate,
	WATER_ANALYSIS_DOCUMENT_TYPE,
	waterAnalysisCertificate,
} from "./document-types/food-export-water"

export const FOOD_EXPORT_SERVICE_CODE = "FOOD-EXPORT"

export function isCrt10Service(code: string | null | undefined): boolean {
	return code === FOOD_EXPORT_SERVICE_CODE || code === WATER_TESTING_SERVICE_CODE
}

function conflict(message: string) {
	return new ORPCError("CONFLICT", { message })
}

async function responseValue(
	tx: Transaction,
	templateId: number,
	answers: Record<string, unknown>,
	label: string,
	type: "text" | "date"
): Promise<string> {
	const fields = await tx
		.select({ id: formFields.id })
		.from(formFields)
		.where(
			and(
				eq(formFields.formTemplateId, templateId),
				eq(formFields.label, label),
				eq(formFields.type, type)
			)
		)
		.limit(2)

	const field = fields[0]
	const value = field ? answers[String(field.id)] : null
	if (fields.length !== 1 || typeof value !== "string" || !value.trim()) {
		throw conflict(`Complete the saved form field: ${label}.`)
	}
	return value.trim()
}

function realDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const date = new Date(`${value}T00:00:00.000Z`)
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export async function buildCrt10Document(
	tx: Transaction,
	item: { id: number; serviceId: number },
	service: { code: string; documentType: string | null },
	context: IssueContext
): Promise<{ type: RenderableDocumentType; payload: Record<string, unknown>; validUntil: null }> {
	if (
		service.code === FOOD_EXPORT_SERVICE_CODE &&
		service.documentType === FOOD_EXPORT_DOCUMENT_TYPE
	) {
		const [submission] = await tx
			.select({
				templateId: formSubmissions.formTemplateId,
				answers: formSubmissions.answers,
			})
			.from(formSubmissions)
			.innerJoin(formTemplates, eq(formTemplates.id, formSubmissions.formTemplateId))
			.where(
				and(
					eq(formSubmissions.bookingItemId, item.id),
					eq(formTemplates.serviceId, item.serviceId),
					eq(formTemplates.purpose, "questionnaire")
				)
			)
			.limit(1)

		if (!submission) throw conflict("Complete the Food Export questionnaire first.")

		const { templateId, answers } = submission
		const exporter = await responseValue(tx, templateId, answers, "Exporter", "text")
		const product = await responseValue(tx, templateId, answers, "Product", "text")
		const quantity = await responseValue(tx, templateId, answers, "Quantity", "text")
		const destination = await responseValue(tx, templateId, answers, "Destination", "text")
		const shipmentDate = await responseValue(tx, templateId, answers, "Shipment date", "date")
		if (!realDate(shipmentDate)) throw conflict("Record a valid shipment date.")

		return {
			type: foodExportCertificate,
			payload: foodExportCertificate.buildPayload(context, {
				exporter,
				product,
				quantity,
				destination,
				shipmentDate,
			}),
			validUntil: null,
		}
	}

	if (
		service.code === WATER_TESTING_SERVICE_CODE &&
		service.documentType === WATER_ANALYSIS_DOCUMENT_TYPE
	) {
		const steps = await tx
			.select({ id: serviceSteps.id })
			.from(serviceSteps)
			.where(
				and(
					eq(serviceSteps.serviceId, item.serviceId),
					eq(serviceSteps.name, WATER_LAB_STEP),
					eq(serviceSteps.isActive, true),
					eq(serviceSteps.required, true)
				)
			)
			.limit(2)

		const laboratory = steps[0]
		if (steps.length !== 1 || !laboratory) {
			throw conflict("Configure one required Laboratory analysis Step for Water Testing.")
		}

		const [result] = await tx
			.select({
				templateId: stepResults.formTemplateId,
				answers: stepResults.answers,
			})
			.from(stepResults)
			.innerJoin(formTemplates, eq(formTemplates.id, stepResults.formTemplateId))
			.where(
				and(
					eq(stepResults.bookingItemId, item.id),
					eq(stepResults.serviceStepId, laboratory.id),
					eq(formTemplates.serviceId, item.serviceId),
					eq(formTemplates.serviceStepId, laboratory.id),
					eq(formTemplates.purpose, "step_result")
				)
			)
			.orderBy(desc(stepResults.version))
			.limit(1)

		if (!result) throw conflict("Record the Laboratory analysis first.")

		const value = await responseValue(
			tx,
			result.templateId,
			result.answers,
			WATER_RESULT_FIELD,
			"text"
		)
		const analysis = parseWaterAnalysis(value)
		if (!analysis.ok) throw conflict(analysis.message)

		return {
			type: waterAnalysisCertificate,
			payload: waterAnalysisCertificate.buildPayload(context, {
				parameters: analysis.parameters,
				outcome: analysis.outcome,
			}),
			validUntil: null,
		}
	}

	throw conflict("The CRT-10 Service and Document type do not match.")
}
