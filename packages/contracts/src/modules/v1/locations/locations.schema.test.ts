import { describe, expect, it } from "vitest"

import {
	CreateLocationSchema,
	LocationSchema,
	UpdateLocationRequestSchema,
} from "./locations.schema.js"

describe("location schemas", () => {
	it("requires the location code, name, address, and region on create", () => {
		expect(
			CreateLocationSchema.safeParse({
				code: "MNL",
				name: "Manila",
				address: "Port Area, Manila",
				region: "NCR",
			}).success
		).toBe(true)
		expect(
			CreateLocationSchema.safeParse({
				code: "MNL",
				name: "Manila",
				address: "",
				region: "NCR",
			}).success
		).toBe(false)
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
