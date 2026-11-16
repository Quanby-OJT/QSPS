import { z } from "zod"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

const LocationCodeSchema = z
	.string()
	.trim()
	.min(1, "Code is required")
	.max(32, "Code must be 32 characters or fewer")

export const LocationSchema = z.object({
	code: LocationCodeSchema,
	name: z.string().min(1).max(150),
	address: z.string().min(1).max(500),
	region: z.string().min(1).max(120),
	isActive: z.boolean(),
	createdAt: dateField,
	updatedAt: dateField,
})

export const CreateLocationSchema = z.object({
	code: LocationCodeSchema,
	name: z.string().trim().min(1, "Name is required").max(150),
	address: z.string().trim().min(1, "Address is required").max(500),
	region: z.string().trim().min(1, "Region is required").max(120),
})

export const LocationCodeParamSchema = z.object({
	code: LocationCodeSchema,
})

export const UpdateLocationRequestSchema = LocationCodeParamSchema.extend({
	name: z.string().trim().min(1, "Name is required").max(150).optional(),
	address: z.string().trim().min(1, "Address is required").max(500).optional(),
	region: z.string().trim().min(1, "Region is required").max(120).optional(),
}).refine(
	({ name, address, region }) =>
		name !== undefined || address !== undefined || region !== undefined,
	"At least one location field must be provided"
)

export const SetLocationActiveRequestSchema = LocationCodeParamSchema.extend({
	isActive: z.boolean(),
})

export const DeleteLocationResponseSchema = z.object({
	success: z.boolean(),
	code: LocationCodeSchema,
})

export type Location = z.infer<typeof LocationSchema>
export type CreateLocationInput = z.infer<typeof CreateLocationSchema>
export type UpdateLocationRequest = z.infer<typeof UpdateLocationRequestSchema>
