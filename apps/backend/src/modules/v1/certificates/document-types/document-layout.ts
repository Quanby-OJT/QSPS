import type { PdfDocument } from "@/common/pdf/pdf.service"

import type { PdfExtras } from "./document-type"

const LABEL_COLOR = "#555555"
const RULE_COLOR = "#cccccc"

export interface LayoutField {
	label: string
	value: string
}

export interface LayoutSection {
	heading: string
	fields: LayoutField[]
}

/** What one A4 certificate says, in reading order (CRT-5). */
export interface DocumentLayout {
	title: string
	subtitle: string
	sections: LayoutSection[]
	/** A sentence printed above the instructions for verifying the document. */
	note: string
}

/**
 * Draws the A4 layout shared by the sanitation documents (CRT-5): title and QR
 * code on top, the number and status, then one block per section, then how to
 * verify it. Same look as the vaccination record and the Medical Exemption
 * Certificate. A long value wraps and pushes the lines below it down.
 */
export function drawDocumentLayout(
	doc: PdfDocument,
	layout: DocumentLayout,
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
		.text(layout.title, left, 50, { width: width - qrSize - 10 })
	doc
		.font("Helvetica")
		.fontSize(9)
		.fillColor(LABEL_COLOR)
		.text(layout.subtitle, left, 74, { width: width - qrSize - 10 })
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
		// A long value wraps; move down by what was actually drawn.
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
	for (const section of layout.sections) {
		doc.font("Helvetica-Bold").fontSize(9).fillColor(LABEL_COLOR).text(section.heading, left, y)
		y += 16
		for (const item of section.fields) field(item.label, item.value, full)
		rule()
	}

	doc
		.font("Helvetica")
		.fontSize(8.5)
		.fillColor(LABEL_COLOR)
		.text(
			`${layout.note} Verify it by scanning the QR code or opening ${extras.verifyUrl}. ` +
				`Without a scanner, open ${portalUrl} and enter the document number and the code ${verificationCode}.`,
			left,
			y,
			{ width }
		)
}
