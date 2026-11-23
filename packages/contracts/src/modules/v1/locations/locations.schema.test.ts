import { describe, expect, it } from "vitest"

import {
	CreateLocationSchema,
	LocationCodeParamSchema,
	LocationSchema,
	UpdateLocationRequestSchema,
} from "./locations.schema.js"

describe("location schemas", () => {
	it("requires the location code, name, address, and region on create", () => {
		const parsed = CreateLocationSchema.safeParse({
			code: " mnl ",
			name: "Manila",
			address: "Port Area, Manila",
			region: "NCR",
		})
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.code).toBe("MNL")

		expect(
			CreateLocationSchema.safeParse({
				code: "MNL",
				name: "Manila",
				address: "",
				region: "NCR",
			}).success
		).toBe(false)
	})

	it("normalizes location codes in path parameters", () => {
		expect(LocationCodeParamSchema.parse({ code: "mnl" })).toEqual({ code: "MNL" })
	})

	it("rejects empty updates and validates active status in location responses", () => {
		expect(UpdateLocationRequestSchema.safeParse({ code: "MNL" }).success).toBe(false)
		expect(
			LocationSchema.safeParse({
				id: 1,
				code: "MNL",
				name: "Manila",
				address: "Port Area, Manila",
				region: "NCR",
				isActive: false,
				cardOffsetXMm: 0,
				cardOffsetYMm: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			}).success
		).toBe(true)
	})

	it("accepts card print offsets as the only change, rounded to 0.1 mm (CRT-3)", () => {
		expect(UpdateLocationRequestSchema.parse({ code: "mnl", cardOffsetXMm: 1.26 })).toEqual({
			code: "MNL",
			cardOffsetXMm: 1.3,
		})
		expect(
			UpdateLocationRequestSchema.parse({ code: "MNL", cardOffsetXMm: -2, cardOffsetYMm: 0 })
		).toMatchObject({ cardOffsetXMm: -2, cardOffsetYMm: 0 })
	})

	it("refuses card offsets beyond 30 mm either way (CRT-3)", () => {
		expect(UpdateLocationRequestSchema.safeParse({ code: "MNL", cardOffsetXMm: 31 }).success).toBe(
			false
		)
		expect(
			UpdateLocationRequestSchema.safeParse({ code: "MNL", cardOffsetYMm: -30.5 }).success
		).toBe(false)
	})
})
