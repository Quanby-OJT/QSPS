import { z } from "zod"

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

/** Document issued for the service (CRT-1); null when the service issues none. */
const DocumentTypeSchema = z
	.string()
	.trim()
	.min(1, "Document type cannot be empty")
	.max(100, "Document type must be 100 characters or fewer")
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
	documentType: DocumentTypeSchema,
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
	documentType: DocumentTypeSchema.optional(),
})

/** Path params arrive as text ("/services/7"), so the id is converted to a number. */
export const ServiceIdParamSchema = z.object({ id: z.coerce.number().int().positive() })

/** The code is fixed at creation, like a location code; everything else can change. */
export const UpdateServiceRequestSchema = ServiceIdParamSchema.extend({
	serviceCategoryId: ServiceCategoryIdSchema.optional(),
	name: z.string().trim().min(1, "Service name is required").max(150).optional(),
	feeCentavos: FeeCentavosSchema.optional(),
	requiresApproval: z.boolean().optional(),
	documentType: DocumentTypeSchema.optional(),
}).refine(
	({ serviceCategoryId, name, feeCentavos, requiresApproval, documentType }) =>
		serviceCategoryId !== undefined ||
		name !== undefined ||
		feeCentavos !== undefined ||
		requiresApproval !== undefined ||
		documentType !== undefined,
	"At least one service field must be provided"
)

export const SetServiceActiveRequestSchema = ServiceIdParamSchema.extend({
	isActive: z.boolean(),
})

export type ServiceCategory = z.infer<typeof ServiceCategorySchema>
export type Service = z.infer<typeof ServiceSchema>
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>
export type UpdateServiceRequest = z.infer<typeof UpdateServiceRequestSchema>