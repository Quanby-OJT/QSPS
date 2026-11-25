import type { HaccpDetails } from "@repo/contracts"

import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"
import { answerOf, requiredAnswer } from "./questionnaire-answers"

/**
 * The questions of the GMP-HACCP audit questionnaire that a HACCP Certificate
 * is built from (CRT-6). Keep this wording in step with the seed migration that
 * creates the questionnaire; an admin who renames a question must rename it
 * here too, or the certificate cannot be issued.
 */
export const HACCP_QUESTIONS = {
	establishmentName: "Establishment name",
	productsOrProcesses: "Products or processes to be audited",
	ownerName: "Owner or operator",
	address: "Business address",
	contactNumber: "Contact number",
} as const

const DOCUMENT_NAME = "HACCP Certificate"

/**
 * HACCP Certificate (CRT-6, document type `haccp`, TOR §VIII.3), issued to an
 * establishment whose GMP-HACCP audit was cleared. The establishment's details
 * come from the client's questionnaire answers, the audit date from the booked
 * slot and the validity from the officer. Wording and numbering are
 * assumptions until BOQ signs them off (PRD open item 6).
 */
export interface HaccpPayload {
	/**
	 * The establishment. Stored under `holder.name` like every document type, so
	 * public verification shows it masked, as it does a person's name.
	 */
	holder: { name: string }
	productsOrProcesses: string
	ownerName: string
	address: string
	contactNumber: string | null
	serviceName: string
	/** The day of the audit in Manila, YYYY-MM-DD; null when the slot is unknown. */
	auditDate: string | null
	dateIssued: string
	validFrom: string
	validUntil: string
	issuingStation: string
}

export function buildHaccpPayload(context: IssueContext, details: HaccpDetails): HaccpPayload {
	const question = HACCP_QUESTIONS
	return {
		holder: { name: requiredAnswer(context.answers, question.establishmentName, DOCUMENT_NAME) },
		productsOrProcesses: requiredAnswer(
			context.answers,
			question.productsOrProcesses,
			DOCUMENT_NAME
		),
		ownerName: requiredAnswer(context.answers, question.ownerName, DOCUMENT_NAME),
		address: requiredAnswer(context.answers, question.address, DOCUMENT_NAME),
		contactNumber: answerOf(context.answers, question.contactNumber),
		serviceName: context.serviceName,
		auditDate: context.session ? manilaDateOf(context.session.startsAt) : null,
		dateIssued: manilaDateOf(context.issuedAt),
		validFrom: details.validFrom,
		validUntil: details.validUntil,
		issuingStation: context.locationName,
	}
}

export function drawHaccp(doc: PdfDocument, payload: HaccpPayload, extras: PdfExtras): void {
	drawDocumentLayout(
		doc,
		{
			title: DOCUMENT_NAME,
			subtitle: "Food Safety - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{
					heading: "ESTABLISHMENT",
					fields: [
						{ label: "Name", value: payload.holder.name },
						{ label: "Products/processes", value: payload.productsOrProcesses },
						{ label: "Owner/operator", value: payload.ownerName },
						{ label: "Address", value: payload.address },
						{ label: "Contact No.", value: payload.contactNumber ?? "-" },
					],
				},
				{
					heading: "CERTIFICATION",
					fields: [
						{
							label: "Audit date",
							value: payload.auditDate ? formatCalendarDate(payload.auditDate) : "-",
						},
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

export const haccp: DocumentTypeDefinition<HaccpDetails> = {
	type: "haccp",
	title: DOCUMENT_NAME,
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "HCP",
	buildPayload: (context, details) => ({ ...buildHaccpPayload(context, details) }),
	validUntil: details => details.validUntil,
	draw: (doc, payload, extras) => drawHaccp(doc, payload as unknown as HaccpPayload, extras),
}
