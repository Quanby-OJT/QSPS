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
				code: "MNL",
				name: "Manila",
				address: "Port Area, Manila",
				region: "NCR",
				isActive: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			}).success
		).toBe(true)
	})
})
