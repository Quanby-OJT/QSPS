import type { BiologicalPermitDetails } from "@repo/contracts"

import type { PdfDocument } from "@/common/pdf/pdf.service"

import {
	buildBiologicalBase,
	substanceFields,
	type BiologicalBasePayload,
} from "./biological-substance"
import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"

const DOCUMENT_NAME = "Biological Substance Permit"

/**
 * Biological Substance Permit (CRT-7, document type `biological-permit`,
 * TOR §VIII.3), issued for a cleared biological substance application. The
 * substance, quantity, origin and destination come from the client's
 * questionnaire answers, the validity from the officer. A permit is for a
 * period, so an end date is required, as for a Sanitary Permit: the public
 * verification page shows it as expired the day after. It is stored encrypted
 * (`sensitive`). Wording and numbering are assumptions until BOQ signs them off
 * (PRD open item 6).
 */
export interface BiologicalPermitPayload extends BiologicalBasePayload {
	validFrom: string
	validUntil: string
}

export function buildBiologicalPermitPayload(
	context: IssueContext,
	details: BiologicalPermitDetails
): BiologicalPermitPayload {
	return {
		...buildBiologicalBase(context, DOCUMENT_NAME),
		validFrom: details.validFrom,
		validUntil: details.validUntil,
	}
}

export function drawBiologicalPermit(
	doc: PdfDocument,
	payload: BiologicalPermitPayload,
	extras: PdfExtras
): void {
	drawDocumentLayout(
		doc,
		{
			title: DOCUMENT_NAME,
			subtitle: "Biological substances - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{ heading: "SUBSTANCE", fields: substanceFields(payload) },
				{
					heading: "PERMIT",
					fields: [
						{ label: "Requested by", value: payload.holder.name },
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

export const biologicalPermit: DocumentTypeDefinition<BiologicalPermitDetails> = {
	type: "biological-permit",
	title: DOCUMENT_NAME,
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "BPM",
	sensitive: true,
	buildPayload: (context, details) => ({ ...buildBiologicalPermitPayload(context, details) }),
	validUntil: details => details.validUntil,
	draw: (doc, payload, extras) =>
		drawBiologicalPermit(doc, payload as unknown as BiologicalPermitPayload, extras),
}
