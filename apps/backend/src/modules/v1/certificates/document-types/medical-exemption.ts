import type { MedicalExemptionDetails } from "@repo/contracts"

import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import { formatCalendarDate } from "./calendar-date"
import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"

/**
 * Medical Exemption Certificate (CRT-3, document type `medical-exemption`).
 * Issued instead of the vaccination record when the officer records during
 * Assessment that the client is medically exempt from the vaccine. It has its
 * own number series (prefix MEC) and its own QR code. Fields assumed per Sir
 * Sean until BOQ gives its official template.
 */
export interface MedicalExemptionPayload {
	holder: {
		name: string
		birthDate: string | null
		sex: string | null
		nationality: string | null
		/** Printed on the owner's PDF only; never shown by public verification (CRT-2). */
		passportOrIdNumber: string | null
	}
	/** The vaccine the holder is exempt from: the Service's name. */
	exemptFrom: string
	reason: string
	physicianName: string
	dateIssued: string
	validFrom: string
	validUntil: string | null
	issuingStation: string
}

export function buildMedicalExemptionPayload(
	context: IssueContext,
	details: MedicalExemptionDetails
): MedicalExemptionPayload {
	return {
		holder: {
			name: context.holder.name,
			birthDate: context.holder.birthDate,
			sex: context.holder.gender,
			nationality: context.holder.nationality,
			passportOrIdNumber: details.passportOrIdNumber ?? null,
		},
		exemptFrom: context.serviceName,
		reason: details.reason,
		physicianName: details.physicianName,
		dateIssued: manilaDateOf(context.issuedAt),
		validFrom: details.validFrom,
		validUntil: details.validUntil ?? null,
		issuingStation: context.locationName,
	}
}

const LABEL_COLOR = "#555555"
const RULE_COLOR = "#cccccc"

export function drawMedicalExemption(
	doc: PdfDocument,
	payload: MedicalExemptionPayload,
	extras: PdfExtras
): void {
	const left = doc.page.margins.left
	const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
	const qrSize = 110
	const qrX = left + width - qrSize
	// The code under the QR code, for checking the document without a scanner (CRT-2).
	const verificationCode = extras.verifyUrl.slice(-8)
	const portalUrl = extras.verifyUrl.slice(0, extras.verifyUrl.lastIndexOf("/"))

	doc
		.font("Helvetica-Bold")
		.fontSize(16)
		.fillColor("#000000")
		.text("Medical Exemption Certificate", left, 50, { width: width - qrSize - 10 })
	doc
		.font("Helvetica")
		.fontSize(9)
		.fillColor(LABEL_COLOR)
		.text(
			"Exemption from vaccination - Bureau of Quarantine, Republic of the Philippines",
			left,
			74,
			{
				width: width - qrSize - 10,
			}
		)
	doc.image(extras.qrPng, qrX, 45, { width: qrSize, height: qrSize })
	doc
		.fontSize(7)
		.fillColor(LABEL_COLOR)
		.text("Scan to verify", qrX, 45 + qrSize + 2, { width: qrSize, align: "center" })
	doc
		.font("Courier-Bold")
		.fontSize(8)
		.fillColor("#000000")
		.text(`Code: ${verificationCode}`, qrX, 45 + qrSize + 11, { width: qrSize, align: "center" })

	let y = 120
	const field = (label: string, value: string, valueWidth = width - qrSize - 125) => {
		doc.font("Helvetica").fontSize(9).fillColor(LABEL_COLOR).text(label, left, y, { width: 110 })
		doc
			.font("Helvetica-Bold")
			.fontSize(10)
			.fillColor("#000000")
			.text(value, left + 115, y, { width: valueWidth })
		// A long reason wraps; move down by what was actually drawn.
		y = Math.max(y + 18, doc.y + 6)
	}
	const rule = () => {
		doc
			.moveTo(left, y)
			.lineTo(left + width, y)
			.lineWidth(0.7)
			.strokeColor(RULE_COLOR)
			.stroke()
		y += 10
	}

	field("Document No.", extras.documentNumber)
	field("Status", extras.status.toUpperCase())
	y = Math.max(y, 45 + qrSize + 24) + 6
	rule()

	const full = width - 125
	doc.font("Helvetica-Bold").fontSize(9).fillColor(LABEL_COLOR).text("HOLDER", left, y)
	y += 16
	field("Name", payload.holder.name, full)
	field("Date of birth", formatCalendarDate(payload.holder.birthDate), full)
	field("Sex", payload.holder.sex ?? "-", full)
	field("Nationality", payload.holder.nationality ?? "-", full)
	field("Passport/ID No.", payload.holder.passportOrIdNumber ?? "-", full)
	rule()

	doc.font("Helvetica-Bold").fontSize(9).fillColor(LABEL_COLOR).text("EXEMPTION", left, y)
	y += 16
	field("Exempt from", payload.exemptFrom, full)
	field("Medical reason", payload.reason, full)
	field("Examining physician", payload.physicianName, full)
	field("Date issued", formatCalendarDate(payload.dateIssued), full)
	field("Valid from", formatCalendarDate(payload.validFrom), full)
	field(
		"Valid until",
		payload.validUntil ? formatCalendarDate(payload.validUntil) : "No end date",
		full
	)
	field("Issuing station", payload.issuingStation, full)
	rule()

	doc
		.font("Helvetica")
		.fontSize(8.5)
		.fillColor(LABEL_COLOR)
		.text(
			"This certificate records that the holder was not given the vaccine named above for a medical reason. " +
				`Verify it by scanning the QR code or opening ${extras.verifyUrl}. ` +
				`Without a scanner, open ${portalUrl} and enter the document number and the code ${verificationCode}.`,
			left,
			y,
			{ width }
		)
}

export const medicalExemption: DocumentTypeDefinition<MedicalExemptionDetails> = {
	type: "medical-exemption",
	title: "Medical Exemption Certificate",
	numberPrefix: "MEC",
	buildPayload: (context, details) => ({ ...buildMedicalExemptionPayload(context, details) }),
	validUntil: details => details.validUntil ?? null,
	draw: (doc, payload, extras) =>
		drawMedicalExemption(doc, payload as unknown as MedicalExemptionPayload, extras),
}
