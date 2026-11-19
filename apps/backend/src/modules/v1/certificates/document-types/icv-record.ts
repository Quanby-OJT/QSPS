import type { IcvIssueDetails } from "@repo/contracts"

import type { PdfDocument } from "@/common/pdf/pdf.service"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import type { DocumentTypeDefinition, IssueContext, PdfExtras } from "./document-type"

/**
 * International Certificate of Vaccination or Prophylaxis record (CRT-1,
 * document type `icv-record`). Fields assumed per Sir Sean until BOQ gives its
 * official template; batch/lot number and vaccinator follow the WHO model.
 */
export interface IcvPayload {
	holder: {
		name: string
		birthDate: string | null
		sex: string | null
		nationality: string | null
		/** Printed on the owner's PDF only; never shown by public verification (CRT-2). */
		passportOrIdNumber: string | null
	}
	vaccine: string
	dateGiven: string
	batchNumber: string
	vaccinatorName: string
	validFrom: string
	validUntil: string | null
	issuingStation: string
}

export function buildIcvPayload(context: IssueContext, details: IcvIssueDetails): IcvPayload {
	return {
		holder: {
			name: context.holder.name,
			birthDate: context.holder.birthDate,
			sex: context.holder.gender,
			nationality: context.holder.nationality,
			passportOrIdNumber: details.passportOrIdNumber ?? null,
		},
		vaccine: context.serviceName,
		dateGiven: manilaDateOf(context.issuedAt),
		batchNumber: details.batchNumber,
		vaccinatorName: details.vaccinatorName,
		validFrom: details.validFrom,
		validUntil: details.validUntil ?? null,
		issuingStation: context.locationName,
	}
}

/** "2026-11-19" → "November 19, 2026". Dates are calendar dates, so no timezone shift. */
export function formatCalendarDate(date: string | null): string {
	if (!date) return "-"
	const [year, month, day] = date.split("-").map(Number)
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)))
}

const LABEL_COLOR = "#555555"
const RULE_COLOR = "#cccccc"

export function drawIcvRecord(doc: PdfDocument, payload: IcvPayload, extras: PdfExtras): void {
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
		.text("International Certificate of Vaccination or Prophylaxis", left, 50, {
			width: width - qrSize - 10,
		})
	doc
		.font("Helvetica")
		.fontSize(9)
		.fillColor(LABEL_COLOR)
		.text("Vaccination record - Bureau of Quarantine, Republic of the Philippines", left, 92, {
			width: width - qrSize - 10,
		})
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
		y += 18
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

	doc.font("Helvetica-Bold").fontSize(9).fillColor(LABEL_COLOR).text("HOLDER", left, y)
	y += 16
	const full = width - 125
	field("Name", payload.holder.name, full)
	field("Date of birth", formatCalendarDate(payload.holder.birthDate), full)
	field("Sex", payload.holder.sex ?? "-", full)
	field("Nationality", payload.holder.nationality ?? "-", full)
	field("Passport/ID No.", payload.holder.passportOrIdNumber ?? "-", full)
	rule()

	doc.font("Helvetica-Bold").fontSize(9).fillColor(LABEL_COLOR).text("VACCINATION", left, y)
	y += 16
	field("Vaccine", payload.vaccine, full)
	field("Date given", formatCalendarDate(payload.dateGiven), full)
	field("Batch/lot No.", payload.batchNumber, full)
	field("Vaccinator", payload.vaccinatorName, full)
	field("Valid from", formatCalendarDate(payload.validFrom), full)
	field(
		"Valid until",
		payload.validUntil ? formatCalendarDate(payload.validUntil) : "Life of the person",
		full
	)
	field("Issuing station", payload.issuingStation, full)
	rule()

	doc
		.font("Helvetica")
		.fontSize(8.5)
		.fillColor(LABEL_COLOR)
		.text(
			`Verify this document by scanning the QR code or opening ${extras.verifyUrl}. ` +
				"The verification page reads the record from QSPS, so a changed copy of this PDF will not match. " +
				`Without a scanner, open ${portalUrl} and enter the document number and the code ${verificationCode}.`,
			left,
			y,
			{ width }
		)
}

export const icvRecord: DocumentTypeDefinition<IcvIssueDetails> = {
	type: "icv-record",
	title: "International Certificate of Vaccination record",
	numberPrefix: "ICV",
	buildPayload: (context, details) => ({ ...buildIcvPayload(context, details) }),
	validUntil: details => details.validUntil ?? null,
	draw: (doc, payload, extras) => drawIcvRecord(doc, payload as unknown as IcvPayload, extras),
}
