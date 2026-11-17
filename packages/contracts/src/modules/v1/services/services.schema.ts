import { z } from "zod"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

const ServiceIdSchema = z.number().int().positive()
const ServiceCategoryIdSchema = z.number().int().positive()
const FeeCentavosSchema = z.number().int().min(0).max(2_147_483_647)

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
	name: z.string().min(1).max(150),
	feeCentavos: FeeCentavosSchema,
	requiresHeadApproval: z.boolean(),
	isActive: z.boolean(),
	createdAt: dateField,
	updatedAt: dateField,
})

export const CreateServiceSchema = z.object({
	serviceCategoryId: ServiceCategoryIdSchema,
	name: z.string().trim().min(1, "Service name is required").max(150),
	feeCentavos: FeeCentavosSchema,
	requiresHeadApproval: z.boolean(),
})

export const ServiceIdParamSchema = z.object({ id: ServiceIdSchema })

export const UpdateServiceRequestSchema = ServiceIdParamSchema.extend({
	serviceCategoryId: ServiceCategoryIdSchema.optional(),
	name: z.string().trim().min(1, "Service name is required").max(150).optional(),
	feeCentavos: FeeCentavosSchema.optional(),
	requiresHeadApproval: z.boolean().optional(),
}).refine(
	({ serviceCategoryId, name, feeCentavos, requiresHeadApproval }) =>
		serviceCategoryId !== undefined ||
		name !== undefined ||
		feeCentavos !== undefined ||
		requiresHeadApproval !== undefined,
	"At least one service field must be provided"
)

export const SetServiceActiveRequestSchema = ServiceIdParamSchema.extend({
	isActive: z.boolean(),
})

export type ServiceCategory = z.infer<typeof ServiceCategorySchema>
export type Service = z.infer<typeof ServiceSchema>
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>
export type UpdateServiceRequest = z.infer<typeof UpdateServiceRequestSchema>
