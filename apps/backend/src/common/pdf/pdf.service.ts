import { Injectable } from "@nestjs/common"
import PDFDocument from "pdfkit"
import QRCode from "qrcode"

export type PdfDocument = PDFKit.PDFDocument

export interface PdfInfo {
	/** Shown as the document title in PDF viewers. */
	title: string
	/** Page size: "A4" (the default) or [width, height] in points, e.g. a card (CRT-3). */
	size?: "A4" | [number, number]
	/** Page margin in points (default 50). Pre-printed stock uses 0. */
	margin?: number
}

/**
 * Renders PDFs on demand (PAY-2; reused by the certificates epic).
 *
 * Nothing is written to disk: callers draw from database rows and send the
 * bytes straight to the client, so the record stays the source of truth.
 */
@Injectable()
export class PdfService {
	/** Run `draw` on a new page (A4 unless `info.size` says otherwise) and return the PDF bytes. */
	async render(info: PdfInfo, draw: (doc: PdfDocument) => void | Promise<void>): Promise<Buffer> {
		const doc = new PDFDocument({
			size: info.size ?? "A4",
			margin: info.margin ?? 50,
			info: { Title: info.title, Creator: "QSPS", Producer: "QSPS" },
		})

		const chunks: Buffer[] = []
		const finished = new Promise<Buffer>((resolve, reject) => {
			doc.on("data", (chunk: Buffer) => chunks.push(chunk))
			doc.on("end", () => resolve(Buffer.concat(chunks)))
			doc.on("error", reject)
		})

		await draw(doc)
		doc.end()
		return finished
	}

	/** A QR code for `text`, as PNG bytes ready for `doc.image`. */
	qrPng(text: string): Promise<Buffer> {
		return QRCode.toBuffer(text, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 300 })
	}
}
