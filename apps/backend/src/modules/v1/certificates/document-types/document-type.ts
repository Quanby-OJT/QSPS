import type { PdfDocument } from "@/common/pdf/pdf.service"

/** What the issuing transaction knows, read from the database (never typed by staff). */
export interface IssueContext {
	holder: {
		name: string
		birthDate: string | null
		gender: string | null
		nationality: string | null
	}
	serviceName: string
	locationName: string
	/** When the document is issued; its Manila date is the date given. */
	issuedAt: Date
	/**
	 * The client's questionnaire answers for this item, by question label (CRT-5).
	 * Only loaded for types built from the questionnaire, such as the Sanitary Permit.
	 */
	answers?: Record<string, string>
	/**
	 * The Schedule Slot the item is booked into (CRT-6): the seminar session a
	 * Food Safety Training Certificate is for, or the day of a HACCP audit.
	 */
	session?: { startsAt: Date; endsAt: Date }
}

/** Printed around the payload on every document. */
export interface PdfExtras {
	documentNumber: string
	status: "valid" | "revoked" | "superseded"
	verifyUrl: string
	qrPng: Buffer
}

/**
 * How far a card print is shifted for one station's printer (CRT-3), in
 * millimetres: positive X moves right, positive Y moves down. Read from the
 * issuing Location's `card_offset_x_mm` and `card_offset_y_mm`.
 */
export interface CardOffsets {
	xMm: number
	yMm: number
}

/**
 * A layout for pre-printed stock (CRT-3): only the values are printed, at
 * fixed positions, because the card already carries the labels and boxes.
 */
export interface CardLayout {
	/** Page size in points, [width, height]. */
	size: [number, number]
	draw(
		doc: PdfDocument,
		payload: Record<string, unknown>,
		extras: PdfExtras,
		offsets: CardOffsets
	): void
}

/**
 * What every registered type can do with a document that already exists:
 * name it, draw its PDF, and, for types printed on pre-printed stock, draw
 * the card layout (CRT-3).
 */
export interface RenderableDocumentType {
	type: string
	/** Shown as the PDF title. */
	title: string
	/** First part of the Document Number, e.g. "ICV". */
	numberPrefix: string
	draw(doc: PdfDocument, payload: Record<string, unknown>, extras: PdfExtras): void
	/** Present when staff print this type onto a pre-printed card (CRT-3). */
	card?: CardLayout
}

/**
 * One entry in the document-type registry (CRT-1): how a type is numbered,
 * what its payload holds, and how its PDF is drawn. CRT-3 to CRT-10 add types
 * by adding entries, not by changing DocumentService.
 */
export interface DocumentTypeDefinition<TDetails> extends RenderableDocumentType {
	/** Everything printed on the document, copied at issue time into documents.payload. */
	buildPayload(context: IssueContext, details: TDetails): Record<string, unknown>
	/** documents.valid_until (YYYY-MM-DD), or null when it does not expire. */
	validUntil(details: TDetails): string | null
}
