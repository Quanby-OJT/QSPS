import { describe, expect, it } from "vitest"

import { CreateServiceSchema, UpdateServiceRequestSchema } from "./services.schema.js"

describe("service schemas", () => {
	it("accepts integer-centavo fees including free services", () => {
		expect(
			CreateServiceSchema.parse({
				serviceCategoryId: 1,
				name: "Yellow fever vaccination",
				feeCentavos: 12500,
				requiresHeadApproval: true,
			})
		).toMatchObject({ feeCentavos: 12500, requiresHeadApproval: true })

		expect(
			CreateServiceSchema.parse({
				serviceCategoryId: 1,
				name: "Free consultation",
				feeCentavos: 0,
				requiresHeadApproval: false,
			}).feeCentavos
		).toBe(0)
	})

	it("rejects fractional, negative, and overflowing centavo values", () => {
		const base = {
			serviceCategoryId: 1,
			name: "Service",
			requiresHeadApproval: false,
		}

		expect(CreateServiceSchema.safeParse({ ...base, feeCentavos: 1.5 }).success).toBe(false)
		expect(CreateServiceSchema.safeParse({ ...base, feeCentavos: -1 }).success).toBe(false)
		expect(CreateServiceSchema.safeParse({ ...base, feeCentavos: 2_147_483_648 }).success).toBe(
			false
		)
	})

	it("requires an update to include at least one editable field", () => {
		expect(UpdateServiceRequestSchema.safeParse({ id: 1 }).success).toBe(false)
		expect(UpdateServiceRequestSchema.safeParse({ id: 1, feeCentavos: 200 }).success).toBe(true)
	})
})
