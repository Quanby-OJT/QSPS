import { z } from "zod"

const dateField = z
	.union([z.date(), z.string()])
	.transform(value => (typeof value === "string" ? new Date(value) : value))

const LocationCodeSchema = z
	.string()
	.trim()
	.min(1, "Code is required")
	.max(32, "Code must be 32 characters or fewer")

const NormalizedLocationCodeSchema = LocationCodeSchema.transform(code => code.toUpperCase())

/**
 * How far the vaccination card print is shifted at this Location, in
 * millimetres (CRT-3). Positive X moves right, positive Y moves down. Set by
 * calibrating against a physical card on the station's passbook printer.
 */
export const MAX_CARD_OFFSET_MM = 30

const CardOffsetSchema = z
	.number()
	.min(
		-MAX_CARD_OFFSET_MM,
		`An offset must be between -${MAX_CARD_OFFSET_MM} and ${MAX_CARD_OFFSET_MM} mm`
	)
	.max(
		MAX_CARD_OFFSET_MM,
		`An offset must be between -${MAX_CARD_OFFSET_MM} and ${MAX_CARD_OFFSET_MM} mm`
	)
	// Kept to 0.1 mm steps, finer than a passbook printer can line up.
	.transform(value => Math.round(value * 10) / 10)

export const LocationSchema = z.object({
	/** Primary key; other tables (such as schedule_slots) reference a location by this. */
	id: z.number().int().positive(),
	code: LocationCodeSchema,
	name: z.string().min(1).max(150),
	address: z.string().min(1).max(500),
	region: z.string().min(1).max(120),
	isActive: z.boolean(),
	/** Card print offsets (CRT-3), in millimetres. */
	cardOffsetXMm: z.number(),
	cardOffsetYMm: z.number(),
	createdAt: dateField,
	updatedAt: dateField,
})

export const CreateLocationSchema = z.object({
	code: NormalizedLocationCodeSchema,
	name: z.string().trim().min(1, "Name is required").max(150),
	address: z.string().trim().min(1, "Address is required").max(500),
	region: z.string().trim().min(1, "Region is required").max(120),
})

export const LocationCodeParamSchema = z.object({
	code: NormalizedLocationCodeSchema,
})

export const UpdateLocationRequestSchema = LocationCodeParamSchema.extend({
	name: z.string().trim().min(1, "Name is required").max(150).optional(),
	address: z.string().trim().min(1, "Address is required").max(500).optional(),
	region: z.string().trim().min(1, "Region is required").max(120).optional(),
	cardOffsetXMm: CardOffsetSchema.optional(),
	cardOffsetYMm: CardOffsetSchema.optional(),
}).refine(
	({ name, address, region, cardOffsetXMm, cardOffsetYMm }) =>
		name !== undefined ||
		address !== undefined ||
		region !== undefined ||
		cardOffsetXMm !== undefined ||
		cardOffsetYMm !== undefined,
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
