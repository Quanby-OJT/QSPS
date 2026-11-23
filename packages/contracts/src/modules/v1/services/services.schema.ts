import { z } from "zod"

import { SERVICE_DOCUMENT_TYPES } from "../certificates/certificates.schema.js"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

const ServiceIdSchema = z.number().int().positive()
const ServiceCategoryIdSchema = z.number().int().positive()
const FeeCentavosSchema = z.number().int().min(0).max(2_147_483_647)

/** Same rule as location codes: trimmed, 1–32 characters, stored uppercase. */
const ServiceCodeSchema = z
	.string()
	.trim()
	.min(1, "Code is required")
	.max(32, "Code must be 32 characters or fewer")

const NormalizedServiceCodeSchema = ServiceCodeSchema.transform(code => code.toUpperCase())

/**
 * Document stored on a service, as read back. Older rows may hold free text from
 * before CRT-1, so the response accepts any short string; null = none.
 */
const StoredDocumentTypeSchema = z.string().trim().min(1).max(100).nullable()

/** Document a service issues when cleared (CRT-1): one QSPS knows how to issue, or null. */
const DocumentTypeInputSchema = z
	.enum(SERVICE_DOCUMENT_TYPES, { error: "Choose a document type QSPS can issue" })
	.nullable()

export const ServiceCategorySchema = z.object({
	id: ServiceCategoryIdSchema,
	code: z.string().min(1).max(64),
	name: z.string().min(1).max(150),
})

export const ServiceSchema = z.object({
	id: ServiceIdSchema,
	serviceCategoryId: ServiceCategoryIdSchema,
	categoryCode: z.string().min(1).max(64),
	categoryName: z.string().min(1).max(150),
	code: ServiceCodeSchema,
	name: z.string().min(1).max(150),
	feeCentavos: FeeCentavosSchema,
	requiresApproval: z.boolean(),
	documentType: StoredDocumentTypeSchema,
	/** Whether clearing issues the document at once (CRT-1). */
	autoIssue: z.boolean(),
	isActive: z.boolean(),
	createdAt: dateField,
	updatedAt: dateField,
})

export const CreateServiceSchema = z.object({
	serviceCategoryId: ServiceCategoryIdSchema,
	code: NormalizedServiceCodeSchema,
	name: z.string().trim().min(1, "Service name is required").max(150),
	feeCentavos: FeeCentavosSchema,
	requiresApproval: z.boolean(),
	documentType: DocumentTypeInputSchema.optional(),
	/** Defaults to true when left out. */
	autoIssue: z.boolean().optional(),
})

/** Path params arrive as text ("/services/7"), so the id is converted to a number. */
export const ServiceIdParamSchema = z.object({ id: z.coerce.number().int().positive() })

/** The code is fixed at creation, like a location code; everything else can change. */
export const UpdateServiceRequestSchema = ServiceIdParamSchema.extend({
	serviceCategoryId: ServiceCategoryIdSchema.optional(),
	name: z.string().trim().min(1, "Service name is required").max(150).optional(),
	feeCentavos: FeeCentavosSchema.optional(),
	requiresApproval: z.boolean().optional(),
	documentType: DocumentTypeInputSchema.optional(),
	autoIssue: z.boolean().optional(),
}).refine(
	({ serviceCategoryId, name, feeCentavos, requiresApproval, documentType, autoIssue }) =>
		serviceCategoryId !== undefined ||
		name !== undefined ||
		feeCentavos !== undefined ||
		requiresApproval !== undefined ||
		documentType !== undefined ||
		autoIssue !== undefined,
	"At least one service field must be provided"
)

export const SetServiceActiveRequestSchema = ServiceIdParamSchema.extend({
	isActive: z.boolean(),
})

export type ServiceCategory = z.infer<typeof ServiceCategorySchema>
export type Service = z.infer<typeof ServiceSchema>
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>
export type UpdateServiceRequest = z.infer<typeof UpdateServiceRequestSchema>
