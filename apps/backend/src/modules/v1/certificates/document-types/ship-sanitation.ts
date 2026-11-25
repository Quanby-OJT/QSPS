import type { ShipSanitationDetails } from "@repo/contracts"

import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"
import { answerOf, requiredAnswer } from "./questionnaire-answers"

/**
 * The questions of the ship sanitation questionnaire that the certificate is
 * built from (CRT-5). Keep this wording in step with the seed migration that
 * creates the questionnaire; an admin who renames a question must rename it
 * here too, or the certificate cannot be issued.
 */
export const SHIP_SANITATION_QUESTIONS = {
	vesselName: "Vessel name",
	vesselType: "Type of vessel",
	registryNumber: "Registry or IMO number",
	registryPort: "Flag or port of registry",
	grossTonnage: "Gross tonnage",
	masterName: "Master or agent",
	lastPortOfCall: "Last port of call",
} as const

const DOCUMENT_NAME = "Ship Sanitation Certificate"

/**
 * Ship Sanitation Certificate (CRT-5, document type `ship-sanitation`, TOR
 * §VIII.3). The vessel's details come from the client's questionnaire
 * answers; the inspection findings and the validity from the officer. Wording
 * and numbering are assumptions until BOQ signs them off (PRD open item 6).
 */
export interface ShipSanitationPayload {
	/**
	 * The vessel. Stored under `holder.name` like every document type, so
	 * public verification shows it masked, as it does a person's name.
	 */
	holder: { name: string }
	vesselType: string | null
	registryNumber: string
	registryPort: string
	grossTonnage: string | null
	masterName: string | null
	lastPortOfCall: string | null
	findings: string
	serviceName: string
	dateIssued: string
	validFrom: string
	validUntil: string
	issuingStation: string
}

export function buildShipSanitationPayload(
	context: IssueContext,
	details: ShipSanitationDetails
): ShipSanitationPayload {
	const question = SHIP_SANITATION_QUESTIONS
	return {
		holder: { name: requiredAnswer(context.answers, question.vesselName, DOCUMENT_NAME) },
		vesselType: answerOf(context.answers, question.vesselType),
		registryNumber: requiredAnswer(context.answers, question.registryNumber, DOCUMENT_NAME),
		registryPort: requiredAnswer(context.answers, question.registryPort, DOCUMENT_NAME),
		grossTonnage: answerOf(context.answers, question.grossTonnage),
		masterName: answerOf(context.answers, question.masterName),
		lastPortOfCall: answerOf(context.answers, question.lastPortOfCall),
		findings: details.findings,
		serviceName: context.serviceName,
		dateIssued: manilaDateOf(context.issuedAt),
		validFrom: details.validFrom,
		validUntil: details.validUntil,
		issuingStation: context.locationName,
	}
}

export function drawShipSanitation(
	doc: PdfDocument,
	payload: ShipSanitationPayload,
	extras: PdfExtras
): void {
	drawDocumentLayout(
		doc,
		{
			title: DOCUMENT_NAME,
			subtitle: "Ship sanitation - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{
					heading: "VESSEL",
					fields: [
						{ label: "Vessel name", value: payload.holder.name },
						{ label: "Type", value: payload.vesselType ?? "-" },
						{ label: "Registry/IMO No.", value: payload.registryNumber },
						{ label: "Flag/port of registry", value: payload.registryPort },
						{ label: "Gross tonnage", value: payload.grossTonnage ?? "-" },
						{ label: "Master/agent", value: payload.masterName ?? "-" },
						{ label: "Last port of call", value: payload.lastPortOfCall ?? "-" },
					],
				},
				{
					heading: "INSPECTION",
					fields: [{ label: "Findings", value: payload.findings }],
				},
				{
					heading: "VALIDITY",
					fields: [
						{ label: "Date issued", value: formatCalendarDate(payload.dateIssued) },
						{ label: "Valid from", value: formatCalendarDate(payload.validFrom) },
						{ label: "Valid until", value: formatCalendarDate(payload.validUntil) },
						{ label: "Issuing station", value: payload.issuingStation },
					],
				},
			],
			note: `This certificate is valid until ${formatCalendarDate(payload.validUntil)}; after that day it is expired.`,
		},
		extras
	)
}

export const shipSanitation: DocumentTypeDefinition<ShipSanitationDetails> = {
	type: "ship-sanitation",
	title: DOCUMENT_NAME,
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "SSC",
	buildPayload: (context, details) => ({ ...buildShipSanitationPayload(context, details) }),
	validUntil: details => details.validUntil,
	draw: (doc, payload, extras) =>
		drawShipSanitation(doc, payload as unknown as ShipSanitationPayload, extras),
}
