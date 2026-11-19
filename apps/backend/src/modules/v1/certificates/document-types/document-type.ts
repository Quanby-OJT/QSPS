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
}

/** Printed around the payload on every document. */
export interface PdfExtras {
	documentNumber: string
	status: "valid" | "revoked" | "superseded"
	verifyUrl: string
	qrPng: Buffer
}

/**
 * One entry in the document-type registry (CRT-1): how a type is numbered,
 * what its payload holds, and how its PDF is drawn. CRT-3 to CRT-10 add types
 * by adding entries, not by changing DocumentService.
 */
export interface DocumentTypeDefinition<TDetails> {
	type: string
	/** Shown as the PDF title. */
	title: string
	/** First part of the Document Number, e.g. "ICV". */
	numberPrefix: string
	/** Everything printed on the document, copied at issue time into documents.payload. */
	buildPayload(context: IssueContext, details: TDetails): Record<string, unknown>
	/** documents.valid_until (YYYY-MM-DD), or null when it does not expire. */
	validUntil(details: TDetails): string | null
	draw(doc: PdfDocument, payload: Record<string, unknown>, extras: PdfExtras): void
}