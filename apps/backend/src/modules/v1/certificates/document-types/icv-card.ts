import type { PdfDocument } from "@/common/pdf/pdf.service"

import { formatCardDate } from "./calendar-date"
import type { CardLayout, CardOffsets, PdfExtras } from "./document-type"
// Type only, so the two files do not load each other at runtime.
import type { IcvPayload } from "./icv-record"

/** PDF points per millimetre (72 points to the inch, 25.4 mm to the inch). */
const POINTS_PER_MM = 72 / 25.4

export function mmToPoints(mm: number): number {
	return mm * POINTS_PER_MM
}

/**
 * The open page of the pre-printed yellow card (International Certificate of
 * Vaccination or Prophylaxis) that the passbook printer takes, in millimetres.
 *
 * ASSUMED until calibrated (CRT-3, ticket technical notes): the size and every
 * position below are a starting layout. They must be checked against a
 * physical card and the delivered printer model; each station then fine-tunes
 * the whole print with its Location card offsets instead of changing code.
 */
export const ICV_CARD_SIZE_MM = { width: 148, height: 105 } as const

interface FieldBox {
	/** From the card's left edge, in mm. */
	x: number
	/** From the card's top edge, in mm (top of the text line). */
	y: number
	/** How wide the value may run before it is cut, in mm. */
	width: number
}

/** Where each value goes on the card (mm). Labels are already printed on the card. */
export const ICV_CARD_FIELDS_MM = {
	holderName: { x: 14, y: 16, width: 120 },
	birthDate: { x: 14, y: 25, width: 36 },
	sex: { x: 56, y: 25, width: 18 },
	nationality: { x: 80, y: 25, width: 54 },
	passportOrIdNumber: { x: 14, y: 34, width: 60 },
	vaccine: { x: 14, y: 51, width: 38 },
	dateGiven: { x: 56, y: 51, width: 26 },
	vaccinatorName: { x: 86, y: 51, width: 48 },
	batchNumber: { x: 14, y: 61, width: 38 },
	validFrom: { x: 56, y: 61, width: 26 },
	validUntil: { x: 86, y: 61, width: 26 },
	issuingStation: { x: 14, y: 71, width: 70 },
	documentNumber: { x: 14, y: 92, width: 80 },
} as const satisfies Record<string, FieldBox>

/** The small QR code for verification (CRT-2), in mm: top-left corner and side. */
export const ICV_CARD_QR_MM = { x: 120, y: 76, size: 22 } as const

/**
 * Where a box lands on the page, in points, once the station's offsets are
 * added. Pure, so the calibration arithmetic can be tested without a PDF.
 */
export function placeOnCard(
	box: { x: number; y: number },
	offsets: CardOffsets
): { x: number; y: number } {
	return { x: mmToPoints(box.x + offsets.xMm), y: mmToPoints(box.y + offsets.yMm) }
}

/** The values printed onto the card, in ICV_CARD_FIELDS_MM order; dates in the short card form. */
export function icvCardValues(
	payload: IcvPayload,
	documentNumber: string
): Record<keyof typeof ICV_CARD_FIELDS_MM, string> {
	return {
		holderName: payload.holder.name,
		birthDate: formatCardDate(payload.holder.birthDate),
		sex: payload.holder.sex ?? "-",
		nationality: payload.holder.nationality ?? "-",
		passportOrIdNumber: payload.holder.passportOrIdNumber ?? "-",
		vaccine: payload.vaccine,
		dateGiven: formatCardDate(payload.dateGiven),
		vaccinatorName: payload.vaccinatorName,
		batchNumber: payload.batchNumber,
		validFrom: formatCardDate(payload.validFrom),
		validUntil: payload.validUntil ? formatCardDate(payload.validUntil) : "Life of the person",
		issuingStation: payload.issuingStation,
		documentNumber,
	}
}

/**
 * Print the vaccination details onto the pre-printed yellow card (CRT-3,
 * TOR §VIII.3). Only values are printed, in black, at fixed positions shifted
 * by the station's offsets; the card's own labels and boxes are not drawn.
 */
export function drawIcvCard(
	doc: PdfDocument,
	payload: IcvPayload,
	extras: PdfExtras,
	offsets: CardOffsets
): void {
	const values = icvCardValues(payload, extras.documentNumber)
	doc.font("Helvetica").fontSize(9).fillColor("#000000")

	for (const [field, box] of Object.entries(ICV_CARD_FIELDS_MM) as [
		keyof typeof ICV_CARD_FIELDS_MM,
		FieldBox,
	][]) {
		const { x, y } = placeOnCard(box, offsets)
		// One line per value, cut at the box width so nothing runs onto the next box.
		doc.text(values[field], x, y, {
			width: mmToPoints(box.width),
			height: mmToPoints(4),
			ellipsis: true,
			lineBreak: false,
		})
	}

	const qr = placeOnCard(ICV_CARD_QR_MM, offsets)
	doc.image(extras.qrPng, qr.x, qr.y, {
		width: mmToPoints(ICV_CARD_QR_MM.size),
		height: mmToPoints(ICV_CARD_QR_MM.size),
	})
}

export const icvCardLayout: CardLayout = {
	size: [mmToPoints(ICV_CARD_SIZE_MM.width), mmToPoints(ICV_CARD_SIZE_MM.height)],
	draw: (doc, payload, extras, offsets) =>
		drawIcvCard(doc, payload as unknown as IcvPayload, extras, offsets),
}
