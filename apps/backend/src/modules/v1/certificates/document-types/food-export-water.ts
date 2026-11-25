import type { PdfDocument } from "@/common/pdf/pdf.service"

import type { WaterOutcome, WaterParameter } from "../../processing/steps/water-analysis"
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

function heading(
	doc: PdfDocument,
	title: string,
	payload: Record<string, unknown>,
	extras: PdfExtras
) {
	doc.font("Helvetica-Bold").fontSize(18).text(title)
	doc.moveDown(0.5).font("Helvetica").fontSize(11)
	doc.text(`Document number: ${extras.documentNumber}`)
	doc.text(`Issuing Location: ${String(payload.issuingLocation ?? "")}`)
	doc.text(`Document status: ${extras.status.toUpperCase()}`)

	const holder = payload.holder as { name?: string } | undefined
	if (holder?.name) doc.text(`Holder: ${holder.name}`)
	if (typeof payload.issuedAt === "string") {
		const issued = new Intl.DateTimeFormat("en-PH", {
			dateStyle: "medium",
			timeZone: "Asia/Manila",
		}).format(new Date(payload.issuedAt))
		doc.text(`Date issued: ${issued}`)
	}
	doc.moveDown()
}

function field(doc: PdfDocument, label: string, value: unknown) {
	doc.font("Helvetica-Bold").text(label)
	doc
		.font("Helvetica")
		.text(String(value ?? ""))
		.moveDown(0.45)
}

function verification(doc: PdfDocument, extras: PdfExtras) {
	if (doc.y + 120 > doc.page.height - doc.page.margins.bottom) doc.addPage()
	const qrY = doc.y
	doc.image(extras.qrPng, doc.page.margins.left, qrY, { width: 80 })
	doc.y = qrY + 88
	doc.font("Helvetica").fontSize(9).text(extras.verifyUrl)
	doc.text(`Verification code: ${extras.verifyUrl.slice(-8)}`)
}

export const foodExportCertificate: DocumentTypeDefinition<FoodExportDetails> = {
	type: FOOD_EXPORT_DOCUMENT_TYPE,
	title: "Food Export Certificate",
	numberPrefix: "FEX",
	validUntil: () => null,

	buildPayload(context, details) {
		return { ...basePayload(context), ...details }
	},

	draw(doc, payload, extras) {
		heading(doc, "Food Export Certificate", payload, extras)
		field(doc, "Exporter", payload.exporter)
		field(doc, "Product", payload.product)
		field(doc, "Quantity", payload.quantity)
		field(doc, "Destination", payload.destination)
		field(doc, "Shipment date", payload.shipmentDate)
		verification(doc, extras)
	},
}

export const waterAnalysisCertificate: DocumentTypeDefinition<WaterAnalysisDetails> = {
	type: WATER_ANALYSIS_DOCUMENT_TYPE,
	title: "Water Analysis Certificate",
	numberPrefix: "WAC",
	validUntil: () => null,

	buildPayload(context, details) {
		return {
			...basePayload(context),
			analysisOutcome: details.outcome,
			parameters: details.parameters,
		}
	},

	draw(doc, payload, extras) {
		heading(doc, "Water Analysis Certificate", payload, extras)

		const outcome = payload.analysisOutcome
		if (outcome !== "pass" && outcome !== "fail") {
			throw new Error("Water Analysis Certificate is missing its recorded outcome")
		}

		doc
			.fillColor(outcome === "fail" ? "#9b1c1c" : "#155e3b")
			.font("Helvetica-Bold")
			.fontSize(15)
			.text(`Overall analysis outcome: ${outcome === "fail" ? "FAILED" : "PASSED"}`)
			.moveDown()

		doc.fillColor("#111111").fontSize(11)
		for (const parameter of payload.parameters as WaterParameter[]) {
			field(doc, parameter.name, `${parameter.result} — ${parameter.outcome.toUpperCase()}`)
		}
		verification(doc, extras)
	},
}
