import type { PdfDocument } from "@/common/pdf/pdf.service"

import { formatPesos } from "./format"

/**
 * What the Request for Payment shows (CRT-4, TOR §VIII.3): the Services in an
 * unpaid Booking, their fees and the Reference Number, so the cashier can
 * collect without retyping. A printout, not an issued Document: it has no
 * Document Number and creates no `documents` row.
 */
export interface RequestForPaymentData {
	referenceNumber: string
	clientName: string
	/** The Manila date it was printed, YYYY-MM-DD. */
	printedOn: string
	items: { serviceName: string; locationName: string; feeCentavos: number }[]
	/** The Booking's total, in integer centavos. */
	totalCentavos: number
}

const LEFT = 50
const WIDTH = 495
const COLUMNS = {
	service: { x: 50, width: 245 },
	location: { x: 300, width: 135 },
	fee: { x: 440, width: 105 },
} as const
const ROW_HEIGHT = 18
const PAGE_BOTTOM = 740

/** One table row per Service: name, Location, fee. Kept apart from drawing so it can be tested. */
export function requestForPaymentRows(data: RequestForPaymentData): string[][] {
	return data.items.map(item => [
		item.serviceName,
		item.locationName,
		formatPesos(item.feeCentavos),
	])
}

function drawRow(doc: PdfDocument, y: number, cells: string[], bold: boolean): void {
	doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9)
	const [service = "", location = "", fee = ""] = cells
	const clip = { height: ROW_HEIGHT - 4, ellipsis: true, lineBreak: false }
	doc.text(service, COLUMNS.service.x, y, { ...clip, width: COLUMNS.service.width })
	doc.text(location, COLUMNS.location.x, y, { ...clip, width: COLUMNS.location.width })
	doc.text(fee, COLUMNS.fee.x, y, { ...clip, width: COLUMNS.fee.width, align: "right" })
}

function drawRule(doc: PdfDocument, y: number): void {
	doc
		.lineWidth(0.5)
		.moveTo(LEFT, y)
		.lineTo(LEFT + WIDTH, y)
		.stroke("#000000")
}

/**
 * Draw the Request for Payment on A4. The QR code holds the Reference Number,
 * which is what the cashier scans or types to find the Booking.
 */
export function drawRequestForPayment(
	doc: PdfDocument,
	data: RequestForPaymentData,
	qrPng: Buffer
): void {
	doc.fillColor("#000000")
	doc.font("Helvetica-Bold").fontSize(11).text("BUREAU OF QUARANTINE", LEFT, 50, {
		width: WIDTH,
		align: "center",
	})
	doc.fontSize(16).text("REQUEST FOR PAYMENT", LEFT, 68, { width: WIDTH, align: "center" })
	doc
		.font("Helvetica")
		.fontSize(9)
		.text(
			"Present this to the cashier. No service is rendered until payment is completed.",
			LEFT,
			92,
			{ width: WIDTH, align: "center" }
		)

	doc.font("Helvetica").fontSize(10).text("Reference Number", LEFT, 130)
	doc.font("Helvetica-Bold").fontSize(15).text(data.referenceNumber, LEFT, 145)
	doc.font("Helvetica").fontSize(10)
	doc.text(`Client: ${data.clientName}`, LEFT, 172, { width: 380 })
	doc.text(`Printed: ${data.printedOn}`, LEFT, 187)
	doc.image(qrPng, 455, 120, { width: 90, height: 90 })

	let y = 230
	drawRule(doc, y - 4)
	drawRow(doc, y, ["Service", "Location", "Fee"], true)
	y += ROW_HEIGHT
	drawRule(doc, y - 3)

	for (const cells of requestForPaymentRows(data)) {
		if (y > PAGE_BOTTOM) {
			doc.addPage()
			y = 50
		}
		drawRow(doc, y, cells, false)
		y += ROW_HEIGHT
	}

	if (y > PAGE_BOTTOM) {
		doc.addPage()
		y = 50
	}
	drawRule(doc, y - 3)
	drawRow(doc, y + 2, ["Total amount due", "", formatPesos(data.totalCentavos)], true)
	drawRule(doc, y + ROW_HEIGHT + 1)
}
