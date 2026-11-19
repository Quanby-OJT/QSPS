import { z } from "zod"

import { BusinessDateSchema } from "../schedules/schedules.schema.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

/**
 * Document types QSPS can issue (DOMAIN-MODEL.md section 4, "Document types").
 * CRT-1 adds the first one; CRT-3 to CRT-10 add the rest.
 */
export const DOCUMENT_TYPES = ["icv-record"] as const
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES)

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

/** Staff issue a document for a cleared Booking Item (services with auto-issue off). */
export const IssueDocumentSchema = z.object({
	bookingItemId: z.coerce.number().int().positive(),
	details: IcvIssueDetailsSchema,
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

export type DocumentType = z.infer<typeof DocumentTypeSchema>
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>
export type IcvIssueDetails = z.infer<typeof IcvIssueDetailsSchema>
export type IssueDocumentInput = z.infer<typeof IssueDocumentSchema>
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>
export type MyDocuments = z.infer<typeof MyDocumentsSchema>
