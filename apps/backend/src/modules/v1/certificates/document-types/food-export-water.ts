import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import type { WaterOutcome, WaterParameter } from "../../processing/steps/water-analysis"
import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout, type LayoutField } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"

export const FOOD_EXPORT_DOCUMENT_TYPE = "food-export-certificate"
export const WATER_ANALYSIS_DOCUMENT_TYPE = "water-analysis-certificate"

export interface FoodExportDetails {
	exporter: string
	product: string
	quantity: string
	destination: string
	shipmentDate: string
}

export interface WaterAnalysisDetails {
	parameters: WaterParameter[]
	outcome: WaterOutcome
}

function basePayload(context: IssueContext) {
	return {
		holder: { name: context.holder.name },
		issuingLocation: context.locationName,
		issuedAt: context.issuedAt.toISOString(),
	}
}

/** Who asked, when and where it was issued: the last block of both certificates. */
function certificationFields(payload: Record<string, unknown>): LayoutField[] {
	const holder = payload.holder as { name?: string } | undefined
	const issuedAt = typeof payload.issuedAt === "string" ? new Date(payload.issuedAt) : null
	return [
		{ label: "Requested by", value: holder?.name ?? "-" },
		{ label: "Date issued", value: issuedAt ? formatCalendarDate(manilaDateOf(issuedAt)) : "-" },
		{ label: "Issuing station", value: String(payload.issuingLocation ?? "-") },
	]
}

function text(value: unknown): string {
	return typeof value === "string" && value.trim() ? value : "-"
}

export function drawFoodExport(
	doc: PdfDocument,
	payload: Record<string, unknown>,
	extras: PdfExtras
) {
	const shipmentDate = typeof payload.shipmentDate === "string" ? payload.shipmentDate : null
	drawDocumentLayout(
		doc,
		{
			title: "Food Export Certificate",
			subtitle: "Food Export - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{
					heading: "SHIPMENT",
					fields: [
						{ label: "Exporter", value: text(payload.exporter) },
						{ label: "Product", value: text(payload.product) },
						{ label: "Quantity", value: text(payload.quantity) },
						{ label: "Destination", value: text(payload.destination) },
						{
							label: "Shipment date",
							value: shipmentDate ? formatCalendarDate(shipmentDate) : "-",
						},
					],
				},
				{ heading: "CERTIFICATION", fields: certificationFields(payload) },
			],
			note: "This certifies that the Bureau of Quarantine cleared the shipment described above for export.",
		},
		extras
	)
}

export function drawWaterAnalysis(
	doc: PdfDocument,
	payload: Record<string, unknown>,
	extras: PdfExtras
) {
	const outcome = payload.analysisOutcome
	if (outcome !== "pass" && outcome !== "fail") {
		throw new Error("Water Analysis Certificate is missing its recorded outcome")
	}
	const failed = outcome === "fail"
	const parameters = (payload.parameters ?? []) as WaterParameter[]
	drawDocumentLayout(
		doc,
		{
			title: failed ? "Water Analysis Certificate - FAILED" : "Water Analysis Certificate",
			subtitle: "Water Testing - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{
					heading: "ANALYSIS",
					fields: [
						{ label: "Overall outcome", value: failed ? "FAILED" : "PASSED" },
						...parameters.map(parameter => ({
							label: parameter.name,
							value: `${parameter.result} - ${parameter.outcome.toUpperCase()}`,
						})),
					],
				},
				{ heading: "CERTIFICATION", fields: certificationFields(payload) },
			],
			note: failed
				? "The sample described above FAILED the analysis."
				: "The sample described above passed the analysis.",
		},
		extras
	)
}

export const foodExportCertificate: DocumentTypeDefinition<FoodExportDetails> = {
	type: FOOD_EXPORT_DOCUMENT_TYPE,
	title: "Food Export Certificate",
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "FEX",
	validUntil: () => null,
	buildPayload(context, details) {
		return { ...basePayload(context), ...details }
	},
	draw: drawFoodExport,
}

export const waterAnalysisCertificate: DocumentTypeDefinition<WaterAnalysisDetails> = {
	type: WATER_ANALYSIS_DOCUMENT_TYPE,
	title: "Water Analysis Certificate",
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "WAC",
	validUntil: () => null,
	buildPayload(context, details) {
		return {
			...basePayload(context),
			analysisOutcome: details.outcome,
			parameters: details.parameters,
		}
	},
	draw: drawWaterAnalysis,
}
