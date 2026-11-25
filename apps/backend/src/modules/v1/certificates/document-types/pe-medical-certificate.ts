import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import { formatCalendarDate } from "./calendar-date"
import { drawDocumentLayout } from "./document-layout"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"

const DOCUMENT_NAME = "Physical Examination Medical Certificate"

/**
 * Physical Examination Medical Certificate (CRT-9, `pe-medical-certificate`, prefix PEM).
 * Issued on clearance when the Physician evaluation is Fit. It prints no medical
 * results: those stay encrypted in step_results. It does not expire. Wording and
 * numbering await BOQ sign-off (PRD open item 6).
 */
export interface PeMedicalCertificatePayload {
	holder: { name: string }
	serviceName: string
	examinationDate: string | null
	dateIssued: string
	issuingLocation: string
}

export function buildPeMedicalCertificatePayload(
	context: IssueContext
): PeMedicalCertificatePayload {
	return {
		holder: { name: context.holder.name },
		serviceName: context.serviceName,
		examinationDate: context.session ? manilaDateOf(context.session.startsAt) : null,
		dateIssued: manilaDateOf(context.issuedAt),
		issuingLocation: context.locationName,
	}
}

export function drawPeMedicalCertificate(
	doc: PdfDocument,
	payload: PeMedicalCertificatePayload,
	extras: PdfExtras
): void {
	drawDocumentLayout(
		doc,
		{
			title: DOCUMENT_NAME,
			subtitle: "Physical Examination - Bureau of Quarantine, Republic of the Philippines",
			sections: [
				{ heading: "EXAMINEE", fields: [{ label: "Name", value: payload.holder.name }] },
				{
					heading: "EXAMINATION",
					fields: [
						{ label: "Service", value: payload.serviceName },
						{
							label: "Examination date",
							value: payload.examinationDate ? formatCalendarDate(payload.examinationDate) : "-",
						},
						{ label: "Result", value: "Fit" },
						{ label: "Date issued", value: formatCalendarDate(payload.dateIssued) },
						{ label: "Issuing station", value: payload.issuingLocation },
					],
				},
			],
			note: "This certifies that the examinee was evaluated and found fit. Medical results are not printed on this certificate.",
		},
		extras
	)
}

export const peMedicalCertificate: DocumentTypeDefinition<undefined> = {
	type: "pe-medical-certificate",
	title: DOCUMENT_NAME,
	numberPrefix: "PEM",
	buildPayload: context => ({ ...buildPeMedicalCertificatePayload(context) }),
	validUntil: () => null,
	draw: (doc, payload, extras) =>
		drawPeMedicalCertificate(doc, payload as unknown as PeMedicalCertificatePayload, extras),
}
