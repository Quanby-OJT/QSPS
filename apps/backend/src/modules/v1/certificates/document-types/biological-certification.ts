import type { BiologicalCertificationDetails } from "@repo/contracts"

import type { PdfDocument } from "@/common/pdf/pdf.service"

import {
	buildBiologicalBase,
	substanceFields,
	type BiologicalBasePayload,
} from "./biological-substance"
import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"

const DOCUMENT_NAME = "Biological Substance Certification"

/**
 * Biological Substance Certification (CRT-7, document type
 * `biological-certification`, TOR §VIII.3), issued for a cleared biological
 * substance shipment so that carriers and receiving authorities can verify it.
 * Everything printed comes from the client's questionnaire answers, so staff
 * type nothing. It is stored encrypted (`sensitive`). It does not expire.
 * Wording and numbering are assumptions until BOQ signs them off (PRD open
 * item 6).
 */
export type BiologicalCertificationPayload = BiologicalBasePayload

export function buildBiologicalCertificationPayload(
	context: IssueContext,
	// Staff add nothing: the details come from the questionnaire.
	_details?: BiologicalCertificationDetails
): BiologicalCertificationPayload {
	return buildBiologicalBase(context, DOCUMENT_NAME)
}

export function drawBiologicalCertification(
	doc: PdfDocument,
	payload: BiologicalCertificationPayload,
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
					heading: "CERTIFICATION",
					fields: [
						{ label: "Requested by", value: payload.holder.name },
						{ label: "Date issued", value: formatCalendarDate(payload.dateIssued) },
						{ label: "Issuing station", value: payload.issuingStation },
					],
				},
			],
			note: "This certifies that the Bureau of Quarantine cleared the substance described above.",
		},
		extras
	)
}

export const biologicalCertification: DocumentTypeDefinition<BiologicalCertificationDetails> = {
	type: "biological-certification",
	title: DOCUMENT_NAME,
	// Assumed prefix until BOQ signs off the numbering (PRD open item 6).
	numberPrefix: "BCT",
	sensitive: true,
	buildPayload: context => ({ ...buildBiologicalCertificationPayload(context) }),
	validUntil: () => null,
	draw: (doc, payload, extras) =>
		drawBiologicalCertification(doc, payload as unknown as BiologicalCertificationPayload, extras),
}
