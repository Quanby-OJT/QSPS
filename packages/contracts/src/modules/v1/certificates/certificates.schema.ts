import { z } from "zod"

import { BusinessDateSchema } from "../schedules/schedules.schema.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/**
 * Document types QSPS can issue (DOMAIN-MODEL.md section 4, "Document types").
 * CRT-1 adds the vaccination record; CRT-3 adds the Medical Exemption
 * Certificate; CRT-5 to CRT-10 add the rest.
 */
export const DOCUMENT_TYPES = ["icv-record", "medical-exemption"] as const
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES)

/**
 * The types a Service can be set to issue (CRT-3). A Medical Exemption is not
 * a Service of its own: staff issue it instead of the vaccination record of
 * a vaccination Service when the client is medically exempt.
 */
export const SERVICE_DOCUMENT_TYPES = ["icv-record"] as const

/** The document types that exempt a client from a vaccine (CRT-3). */
export const VACCINATION_DOCUMENT_TYPES: readonly string[] = ["icv-record"]

export const DocumentStatusSchema = z.enum(["valid", "revoked", "superseded"])

/** Optional text: trimmed, and an empty field becomes null. */
const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.nullish()
		.transform(value => (value ? value : null))

/**
 * What staff type when an International Certificate of Vaccination record is
 * issued (CRT-1). Assumed fields, per Sir Sean, until BOQ gives its template:
 * batch/lot number and vaccinator are required by the WHO model certificate.
 */
export const IcvIssueDetailsSchema = z
	.object({
		batchNumber: z.string().trim().min(1, "Enter the vaccine batch/lot number").max(50),
		vaccinatorName: z.string().trim().min(1, "Enter the vaccinator's name").max(200),
		validFrom: BusinessDateSchema,
		/** Blank means valid for the life of the person. */
		validUntil: BusinessDateSchema.nullish().transform(value => value ?? null),
		passportOrIdNumber: optionalText(50),
	})
	.refine(value => value.validUntil === null || value.validUntil >= value.validFrom, {
		message: "Valid until cannot be before valid from",
		path: ["validUntil"],
	})

/** Longest reason staff may write on a Medical Exemption Certificate. */
export const MAX_EXEMPTION_REASON_LENGTH = 500

/**
 * What staff record when a client is medically exempt from the vaccine of a
 * vaccination Service (CRT-3, TOR §VIII.3). Assumed fields, per Sir Sean,
 * until BOQ gives its template: the medical reason and the examining
 * physician; an exemption may be temporary, so it can carry an end date.
 */
export const MedicalExemptionDetailsSchema = z
	.object({
		reason: z
			.string()
			.trim()
			.min(1, "Enter the medical reason for the exemption")
			.max(MAX_EXEMPTION_REASON_LENGTH),
		physicianName: z.string().trim().min(1, "Enter the examining physician's name").max(200),
		validFrom: BusinessDateSchema,
		/** Blank means the exemption does not expire. */
		validUntil: BusinessDateSchema.nullish().transform(value => value ?? null),
		passportOrIdNumber: optionalText(50),
	})
	.refine(value => value.validUntil === null || value.validUntil >= value.validFrom, {
		message: "Valid until cannot be before valid from",
		path: ["validUntil"],
	})

/**
 * Staff issue a document for a cleared Booking Item (services with auto-issue
 * off, or after head approval). Give `details` for the vaccination record, or
 * `exemption` for a Medical Exemption Certificate (CRT-3), never both.
 */
export const IssueDocumentSchema = z
	.object({
		bookingItemId: z.coerce.number().int().positive(),
		details: IcvIssueDetailsSchema.nullish().transform(value => value ?? null),
		exemption: MedicalExemptionDetailsSchema.nullish().transform(value => value ?? null),
	})
	.refine(value => (value.details === null) !== (value.exemption === null), {
		message: "Enter the vaccination details or the exemption details, not both",
		path: ["details"],
	})

/** One document as listed to its owner or shown to staff. */
export const DocumentSummarySchema = z.object({
	id: z.number().int().positive(),
	documentType: DocumentTypeSchema,
	documentNumber: z.string(),
	status: DocumentStatusSchema,
	issuedAt: dateField,
	/** Last valid day (YYYY-MM-DD); null when it does not expire. */
	validUntil: z.string().nullable(),
	serviceName: z.string(),
	locationName: z.string(),
	referenceNumber: z.string(),
})

export const MyDocumentsSchema = z.object({
	documents: z.array(DocumentSummarySchema),
})

// ============================================================================
// PUBLIC VERIFICATION (CRT-2)
// ============================================================================

/** A Document Verification Token: 128 random bits, base64url (22 characters). */
export const DocumentTokenSchema = z
	.string()
	.regex(/^[A-Za-z0-9_-]{22}$/, "Not a document verification token")

export const DocumentTokenParamSchema = z.object({ token: DocumentTokenSchema })

/**
 * The code printed under a document's QR code, for checking it without a
 * scanner: the last characters of the Verification Token.
 */
export const VERIFICATION_CODE_LENGTH = 8

/**
 * Manual entry on the public portal: the Document Number as printed plus the
 * code under the QR code. The number alone is not enough, because numbers
 * run in sequence and could be guessed.
 */
export const ManualVerificationSchema = z.object({
	documentNumber: z
		.string()
		.trim()
		.toUpperCase()
		.regex(/^[A-Z0-9][A-Z0-9-]{4,99}$/, "Enter the document number as printed"),
	code: z
		.string()
		.trim()
		.regex(
			new RegExp(`^[A-Za-z0-9_-]{${VERIFICATION_CODE_LENGTH}}$`),
			`Enter the ${VERIFICATION_CODE_LENGTH}-character code printed under the QR code`
		),
})

/**
 * What the public verification page shows (TOR §VIII.4). Read from the
 * database, never from the PDF. Only what is needed to recognise the
 * document: the holder's name is masked, and nothing else from the payload
 * (no birth date, no passport/ID number) is returned.
 */
export const DocumentVerificationSchema = z.object({
	documentType: DocumentTypeSchema,
	/** e.g. "International Certificate of Vaccination record". */
	documentTitle: z.string(),
	documentNumber: z.string(),
	/** e.g. "J*** D*** C***". */
	holderName: z.string(),
	issuingLocation: z.string(),
	issuedAt: dateField,
	status: DocumentStatusSchema,
	/** When it stopped being valid; null while it is valid. */
	statusChangedAt: dateField.nullable(),
})

export type DocumentType = z.infer<typeof DocumentTypeSchema>
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>
export type IcvIssueDetails = z.infer<typeof IcvIssueDetailsSchema>
export type MedicalExemptionDetails = z.infer<typeof MedicalExemptionDetailsSchema>
export type IssueDocumentInput = z.infer<typeof IssueDocumentSchema>
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>
export type MyDocuments = z.infer<typeof MyDocumentsSchema>
export type ManualVerificationInput = z.infer<typeof ManualVerificationSchema>
export type DocumentVerification = z.infer<typeof DocumentVerificationSchema>
