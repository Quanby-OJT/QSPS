import type { PdfDocument } from "@/common/pdf/pdf.service"
import { BUSINESS_TIMEZONE } from "@/modules/v1/schedules/manila-time"

/** Everything printed on an e-Receipt, read from the database. */
export interface ReceiptPdfData {
	receiptNumber: string
	referenceNumber: string
	issuedAt: Date
	clientName: string
	/** The channel's name at payment time, stored on the receipt (PAY-2a), e.g. "GCash". */
	channelName: string
	items: { serviceName: string; feeCentavos: number }[]
	convenienceFeeCentavos: number
	totalCentavos: number
	status: "valid" | "refunded"
	verifyUrl: string
	qrPng: Buffer
}

/** 150000 → "PHP 1,500.00". Plain text: the built-in PDF fonts have no peso sign. */
export function formatPesos(centavos: number): string {
	const amount = (centavos / 100).toLocaleString("en-PH", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})
	return `PHP ${amount}`
}

/**
 * The payment date and time in Manila, e.g. "November 18, 2026 at 9:30 AM (Asia/Manila)".
 * Some ICU versions put a narrow no-break space before AM/PM, which the
 * built-in PDF fonts cannot draw, so every space is made a plain one.
 */
export function formatManilaDateTime(instant: Date): string {
	const text = new Intl.DateTimeFormat("en-US", {
		timeZone: BUSINESS_TIMEZONE,
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})
		.format(instant)
		.replace(/[\u00a0\u202f]/g, " ")
	return `${text} (Asia/Manila)`
}

const LABEL_COLOR = "#555555"
const RULE_COLOR = "#cccccc"

/** Draw one e-Receipt on an A4 page (TOR §VIII.2 fields). */
export function drawReceipt(doc: PdfDocument, data: ReceiptPdfData): void {
	const left = doc.page.margins.left
	const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
	const qrSize = 110
	const qrX = left + width - qrSize

	// Header, with the QR code at the top right.
	doc.font("Helvetica-Bold").fontSize(20).fillColor("#000000").text("e-Receipt", left, 50)
	doc
		.font("Helvetica")
		.fontSize(9)
		.fillColor(LABEL_COLOR)
		.text("Bureau of Quarantine - Quarantine Services and Payment System (QSPS)", left, 76, {
			width: width - qrSize - 10,
		})
	doc.image(data.qrPng, qrX, 45, { width: qrSize, height: qrSize })
	doc
		.fontSize(7)
		.fillColor(LABEL_COLOR)
		.text("Scan to verify", qrX, 45 + qrSize + 2, { width: qrSize, align: "center" })

	// Receipt details.
	const details: [string, string][] = [
		["Receipt No.", data.receiptNumber],
		["Reference No.", data.referenceNumber],
		["Date and time", formatManilaDateTime(data.issuedAt)],
		["Client", data.clientName],
		["Payment channel", data.channelName],
		["Status", data.status === "valid" ? "PAID" : "REFUNDED"],
	]
	let y = 110
	for (const [label, value] of details) {
		doc.font("Helvetica").fontSize(9).fillColor(LABEL_COLOR).text(label, left, y, { width: 110 })
		doc
			.font("Helvetica-Bold")
			.fontSize(10)
			.fillColor("#000000")
			.text(value, left + 115, y, { width: width - qrSize - 125 })
		y += 18
	}

	// Fee breakdown.
	y = Math.max(y, 45 + qrSize + 20) + 12
	const amountX = left + width - 140
	const rule = (at: number) =>
		doc
			.moveTo(left, at)
			.lineTo(left + width, at)
			.lineWidth(0.7)
			.strokeColor(RULE_COLOR)
			.stroke()

	doc.font("Helvetica-Bold").fontSize(9).fillColor(LABEL_COLOR)
	doc.text("SERVICE", left, y)
	doc.text("FEE", amountX, y, { width: 140, align: "right" })
	y += 14
	rule(y)
	y += 8

	const row = (label: string, amount: string, bold = false) => {
		doc
			.font(bold ? "Helvetica-Bold" : "Helvetica")
			.fontSize(bold ? 11 : 10)
			.fillColor("#000000")
		doc.text(label, left, y, { width: width - 150 })
		doc.text(amount, amountX, y, { width: 140, align: "right" })
		y += bold ? 20 : 18
	}

	for (const item of data.items) {
		row(item.serviceName, formatPesos(item.feeCentavos))
	}
	row("Convenience fee", formatPesos(data.convenienceFeeCentavos))
	rule(y)
	y += 8
	row("Total paid", formatPesos(data.totalCentavos), true)

	// Verification note.
	y += 16
	doc
		.font("Helvetica")
		.fontSize(8.5)
		.fillColor(LABEL_COLOR)
		.text(
			`Verify this receipt by scanning the QR code or opening ${data.verifyUrl}. ` +
				"The verification page reads the receipt from QSPS records, so a changed copy of this PDF will not match.",
			left,
			y,
			{ width }
		)
}

/**
 * The passbook-printer page (PAY-4): A6, 105 × 148 mm, the size of a
 * passbook page and of most cashier slip printers. In PDF points.
 */
export const PASSBOOK_PAGE: [number, number] = [297.64, 419.53]

/**
 * The same e-Receipt on a narrow page, one column, for the cashier's
 * passbook printer. Same figures and QR code as the A4 layout.
 */
export function drawPassbookReceipt(doc: PdfDocument, data: ReceiptPdfData): void {
	const left = doc.page.margins.left
	const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
	const qrSize = 64
	let y = doc.page.margins.top

	doc.font("Helvetica-Bold").fontSize(13).fillColor("#000000").text("e-Receipt", left, y)
	doc.image(data.qrPng, left + width - qrSize, y, { width: qrSize, height: qrSize })
	y += 17
	doc
		.font("Helvetica")
		.fontSize(6.5)
		.fillColor(LABEL_COLOR)
		.text("Bureau of Quarantine - QSPS", left, y, { width: width - qrSize - 6 })
	y = doc.page.margins.top + qrSize + 6

	const details: [string, string][] = [
		["Receipt No.", data.receiptNumber],
		["Reference No.", data.referenceNumber],
		["Date and time", formatManilaDateTime(data.issuedAt)],
		["Client", data.clientName],
		["Payment channel", data.channelName],
		["Status", data.status === "valid" ? "PAID" : "REFUNDED"],
	]
	for (const [label, value] of details) {
		doc.font("Helvetica").fontSize(6.5).fillColor(LABEL_COLOR).text(label, left, y, { width: 70 })
		doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000")
		const height = doc.heightOfString(value, { width: width - 74 })
		doc.text(value, left + 74, y, { width: width - 74 })
		y += Math.max(11, height + 2)
	}

	const rule = (at: number) =>
		doc
			.moveTo(left, at)
			.lineTo(left + width, at)
			.lineWidth(0.5)
			.strokeColor(RULE_COLOR)
			.stroke()

	y += 4
	rule(y)
	y += 5
	const amountWidth = 80
	const row = (label: string, amount: string, bold = false) => {
		doc
			.font(bold ? "Helvetica-Bold" : "Helvetica")
			.fontSize(bold ? 8.5 : 7.5)
			.fillColor("#000000")
		const height = doc.heightOfString(label, { width: width - amountWidth - 6 })
		doc.text(label, left, y, { width: width - amountWidth - 6 })
		doc.text(amount, left + width - amountWidth, y, { width: amountWidth, align: "right" })
		y += Math.max(bold ? 13 : 11, height + 2)
	}
	for (const item of data.items) {
		row(item.serviceName, formatPesos(item.feeCentavos))
	}
	row("Convenience fee", formatPesos(data.convenienceFeeCentavos))
	rule(y)
	y += 5
	row("Total paid", formatPesos(data.totalCentavos), true)

	y += 6
	doc
		.font("Helvetica")
		.fontSize(6)
		.fillColor(LABEL_COLOR)
		.text(`Verify: scan the QR code or open ${data.verifyUrl}`, left, y, { width })
}
