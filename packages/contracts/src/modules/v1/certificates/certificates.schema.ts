import { z } from "zod"

import { BusinessDateSchema } from "../schedules/schedules.schema.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/**
 * Document types QSPS can issue (DOMAIN-MODEL.md section 4, "Document types").
 * CRT-1 adds the vaccination record; CRT-3 adds the Medical Exemption
 * Certificate; CRT-5 adds the Sanitary Permit and the Ship Sanitation
 * Certificate; CRT-6 adds the Food Safety Training Certificate and the HACCP
 * Certificate; CRT-7 to CRT-10 add the rest.
 */
export const DOCUMENT_TYPES = [
	"icv-record",
	"medical-exemption",
	"sanitary-permit",
	"ship-sanitation",
	"food-safety-training",
	"haccp",
	"human-remains",
	"biological-certification",
	"biological-permit",
] as const
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES)

/**
 * The types a Service can be set to issue (CRT-3). A Medical Exemption is not
 * a Service of its own: staff issue it instead of the vaccination record of
 * a vaccination Service when the client is medically exempt. The two
 * sanitation types (CRT-5) are issued by sanitation Services, the training and
 * HACCP certificates (CRT-6) by food safety Services.
 */
export const SERVICE_DOCUMENT_TYPES = [
	"icv-record",
	"sanitary-permit",
	"ship-sanitation",
	"food-safety-training",
	"haccp",
	"human-remains",
	"biological-certification",
	"biological-permit",
] as const

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

/** Longest inspection findings text staff may write on a Ship Sanitation Certificate. */
export const MAX_SHIP_FINDINGS_LENGTH = 1000

/**
 * What staff type when a Sanitary Permit is issued (CRT-5, TOR §VIII.3). The
 * establishment's details are copied from the client's questionnaire answers,
 * so staff only set the validity. An end date is required: the public
 * verification page shows the permit as expired the day after it. Assumed
 * fields until BOQ gives its template (PRD open item 6).
 */
export const SanitaryPermitDetailsSchema = z
	.object({
		validFrom: BusinessDateSchema,
		validUntil: BusinessDateSchema,
	})
	.refine(value => value.validUntil >= value.validFrom, {
		message: "Valid until cannot be before valid from",
		path: ["validUntil"],
	})

/**
 * What staff type when a Ship Sanitation Certificate is issued (CRT-5, TOR
 * §VIII.3): the inspection findings and the validity. The vessel's name and
 * registry details are copied from the client's questionnaire answers.
 * Assumed fields until BOQ gives its template (PRD open item 6).
 */
export const ShipSanitationDetailsSchema = z
	.object({
		findings: z
			.string()
			.trim()
			.min(1, "Enter the inspection findings")
			.max(MAX_SHIP_FINDINGS_LENGTH),
		validFrom: BusinessDateSchema,
		validUntil: BusinessDateSchema,
	})
	.refine(value => value.validUntil >= value.validFrom, {
		message: "Valid until cannot be before valid from",
		path: ["validUntil"],
	})

/**
 * What staff type when a HACCP Certificate is issued (CRT-6, TOR §VIII.3). The
 * establishment's details are copied from the client's questionnaire answers,
 * so staff only set the validity. An end date is required, as for a Sanitary
 * Permit: the public verification page shows the certificate as expired the
 * day after it. Assumed fields until BOQ gives its template (PRD open item 6).
 */
export const HaccpDetailsSchema = z
	.object({
		validFrom: BusinessDateSchema,
		validUntil: BusinessDateSchema,
	})
	.refine(value => value.validUntil >= value.validFrom, {
		message: "Valid until cannot be before valid from",
		path: ["validUntil"],
	})

/**
 * What staff type when a Human Remains Certificate is issued (CRT-7, TOR §VIII.3):
 * nothing. The deceased, the consignee and the transport are copied from the
 * client's questionnaire answers. The empty object says "issue this document
 * from the answers", and anything typed in is refused.
 */
export const HumanRemainsDetailsSchema = z.strictObject({})

/** Same for a Biological Substance Certification (CRT-7): the answers are the whole content. */
export const BiologicalCertificationDetailsSchema = z.strictObject({})

/**
 * What staff type when a Biological Substance Permit is issued (CRT-7): only the
 * validity. The substance, quantity, origin and destination come from the
 * client's answers. An end date is required, as for a Sanitary Permit: the
 * public verification page shows the permit as expired the day after it.
 */
export const BiologicalPermitDetailsSchema = z
	.object({
		validFrom: BusinessDateSchema,
		validUntil: BusinessDateSchema,
	})
	.refine(value => value.validUntil >= value.validFrom, {
		message: "Valid until cannot be before valid from",
		path: ["validUntil"],
	})

/**
 * Staff issue a document for a cleared Booking Item (services with auto-issue
 * off, or after head approval). Give exactly one of: `details` for the
 * vaccination record, `exemption` for a Medical Exemption Certificate (CRT-3),
 * `sanitaryPermit` for a Sanitary Permit or `shipSanitation` for a Ship
 * Sanitation Certificate (CRT-5), or `haccp` for a HACCP Certificate (CRT-6).
 * A Food Safety Training Certificate takes no details: it is issued for a
 * whole seminar session from its roster. CRT-7 adds `humanRemains` and
 * `biologicalCertification` (an empty object: everything comes from the client's
 * answers) and `biologicalPermit` (its validity).
 */
export const IssueDocumentSchema = z
	.object({
		bookingItemId: z.coerce.number().int().positive(),
		details: IcvIssueDetailsSchema.nullish().transform(value => value ?? null),
		exemption: MedicalExemptionDetailsSchema.nullish().transform(value => value ?? null),
		sanitaryPermit: SanitaryPermitDetailsSchema.nullish().transform(value => value ?? null),
		shipSanitation: ShipSanitationDetailsSchema.nullish().transform(value => value ?? null),
		haccp: HaccpDetailsSchema.nullish().transform(value => value ?? null),
		humanRemains: HumanRemainsDetailsSchema.nullish().transform(value => value ?? null),
		biologicalCertification: BiologicalCertificationDetailsSchema.nullish().transform(
			value => value ?? null
		),
		biologicalPermit: BiologicalPermitDetailsSchema.nullish().transform(value => value ?? null),
	})
	.superRefine((value, context) => {
		const given = [
			value.details,
			value.exemption,
			value.sanitaryPermit,
			value.shipSanitation,
			value.haccp,
			value.humanRemains,
			value.biologicalCertification,
			value.biologicalPermit,
		]
		if (given.filter(entry => entry !== null).length === 1) return
		// Keep the CRT-3 wording when no sanitation or food safety details are involved.
		const vaccinationOnly =
			value.sanitaryPermit === null &&
			value.shipSanitation === null &&
			value.haccp === null &&
			value.humanRemains === null &&
			value.biologicalCertification === null &&
			value.biologicalPermit === null
		context.addIssue({
			code: "custom",
			message: vaccinationOnly
				? "Enter the vaccination details or the exemption details, not both"
				: "Enter the details of one document only",
			path: ["details"],
		})
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

/** What the public page can say about a document: the stored status, plus `expired`. */
export const DocumentVerificationStatusSchema = z.enum([...DocumentStatusSchema.options, "expired"])

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
	/**
	 * `expired` is worked out on every lookup (CRT-5), never stored: a `valid`
	 * document is `expired` from the day after `validUntil` (Asia/Manila).
	 */
	status: DocumentVerificationStatusSchema,
	/** The last day the document is valid (YYYY-MM-DD); null when it does not expire. */
	validUntil: z.string().nullable(),
	/** When it was revoked or superseded; null otherwise, expired included. */
	statusChangedAt: dateField.nullable(),
})

// ============================================================================
// REVOKE AND REISSUE (CRT-8)
// ============================================================================

/** Longest reason staff may give for revoking or reissuing a document. */
export const MAX_STATUS_REASON_LENGTH = 500

const statusReason = z.string().trim().min(1, "Enter the reason").max(MAX_STATUS_REASON_LENGTH)

/** Withdraw a document (CRT-8). The reason is required; it is kept on the document and in the audit. */
export const RevokeDocumentSchema = z.object({
	documentId: z.coerce.number().int().positive(),
	reason: statusReason,
})

/**
 * Replace a document with a corrected one (CRT-8). The same fields as issuing:
 * `details` for a vaccination record or `exemption` for a Medical Exemption
 * Certificate, never both.
 */
export const ReissueDocumentSchema = z
	.object({
		documentId: z.coerce.number().int().positive(),
		reason: statusReason,
		details: IcvIssueDetailsSchema.nullish().transform(value => value ?? null),
		exemption: MedicalExemptionDetailsSchema.nullish().transform(value => value ?? null),
	})
	.refine(value => (value.details === null) !== (value.exemption === null), {
		message: "Enter the vaccination details or the exemption details, not both",
		path: ["details"],
	})

export type DocumentType = z.infer<typeof DocumentTypeSchema>
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>
export type DocumentVerificationStatus = z.infer<typeof DocumentVerificationStatusSchema>
export type IcvIssueDetails = z.infer<typeof IcvIssueDetailsSchema>
export type MedicalExemptionDetails = z.infer<typeof MedicalExemptionDetailsSchema>
export type SanitaryPermitDetails = z.infer<typeof SanitaryPermitDetailsSchema>
export type ShipSanitationDetails = z.infer<typeof ShipSanitationDetailsSchema>
export type HaccpDetails = z.infer<typeof HaccpDetailsSchema>
export type HumanRemainsDetails = z.infer<typeof HumanRemainsDetailsSchema>
export type BiologicalCertificationDetails = z.infer<typeof BiologicalCertificationDetailsSchema>
export type BiologicalPermitDetails = z.infer<typeof BiologicalPermitDetailsSchema>
export type IssueDocumentInput = z.infer<typeof IssueDocumentSchema>
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>
export type MyDocuments = z.infer<typeof MyDocumentsSchema>
export type ManualVerificationInput = z.infer<typeof ManualVerificationSchema>
export type DocumentVerification = z.infer<typeof DocumentVerificationSchema>
export type RevokeDocumentInput = z.infer<typeof RevokeDocumentSchema>
export type ReissueDocumentInput = z.infer<typeof ReissueDocumentSchema>
