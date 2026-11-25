import type { SanitaryPermitDetails } from "@repo/contracts"

import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"
import { answerOf, requiredAnswer } from "./questionnaire-answers"

/**
 * The questions of the sanitation questionnaire that a Sanitary Permit is
 * built from (CRT-5). Keep this wording in step with the seed migration that
 * creates the questionnaire; an admin who renames a question must rename it
 * here too, or the permit cannot be issued.
 */
export const SANITARY_PERMIT_QUESTIONS = {
	establishmentName: "Establishment name",
	establishmentType: "Type of establishment",
	ownerName: "Owner or operator",
	address: "Business address",
	contactNumber: "Contact number",
} as const

const DOCUMENT_NAME = "Sanitary Permit"

/**
 * Sanitary Permit (CRT-5, document type `sanitary-permit`, TOR §VIII.3). The
 * establishment's details come from the client's questionnaire answers and
 * the validity from the officer. Wording and numbering are assumptions until
 * BOQ signs them off (PRD open item 6).
 */
export interface SanitaryPermitPayload {
	/**
	 * The establishment. Stored under `holder.name` like every document type,
	 * so public verification shows it masked, as it does a person's name.
	 */
	holder: { name: string }
	establishmentType: string
	ownerName: string
	address: string
	contactNumber: string | null
	serviceName: string
	dateIssued: string
	validFrom: string
	validUntil: string
	issuingStation: string
}

export function buildSanitaryPermitPayload(
	context: IssueContext,
	details: SanitaryPermitDetails
): SanitaryPermitPayload {
	const question = SANITARY_PERMIT_QUESTIONS
	return {
		holder: { name: requiredAnswer(context.answers, question.establishmentName, DOCUMENT_NAME) },
		establishmentType: requiredAnswer(context.answers, question.establishmentType, DOCUMENT_NAME),
		ownerName: requiredAnswer(context.answers, question.ownerName, DOCUMENT_NAME),
		address: requiredAnswer(context.answers, question.address, DOCUMENT_NAME),
		contactNumber: answerOf(context.answers, question.contactNumber),
		serviceName: context.serviceName,
		dateIssued: manilaDateOf(context.issuedAt),
		validFrom: details.validFrom,
		validUntil: details.validUntil,
		issuingStation: context.locationName,
	}
}

export function drawSanitaryPermit(
	doc: PdfDocument,
	payload: SanitaryPermitPayload,
	extras: PdfExtras
): void {
	drawDocumentLayout(
		doc,
		{
			title: DOCUMENT_NAME,
			subtitle: "Sanitation - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{
					heading: "ESTABLISHMENT",
					fields: [
						{ label: "Name", value: payload.holder.name },
						{ label: "Type", value: payload.establishmentType },
						{ label: "Owner/operator", value: payload.ownerName },
						{ label: "Address", value: payload.address },
						{ label: "Contact No.", value: payload.contactNumber ?? "-" },
					],
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
			note: `This permit is valid until ${formatCalendarDate(payload.validUntil)}; after that day it is expired.`,
		},
		extras
	)
}

export const sanitaryPermit: DocumentTypeDefinition<SanitaryPermitDetails> = {
	type: "sanitary-permit",
	title: DOCUMENT_NAME,
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "SPM",
	buildPayload: (context, details) => ({ ...buildSanitaryPermitPayload(context, details) }),
	validUntil: details => details.validUntil,
	draw: (doc, payload, extras) =>
		drawSanitaryPermit(doc, payload as unknown as SanitaryPermitPayload, extras),
}
