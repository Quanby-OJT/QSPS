import { describe, expect, it } from "vitest"

import {
	CreateServiceSchema,
	SetServiceActiveRequestSchema,
	UpdateServiceRequestSchema,
} from "./services.schema.js"

const base = {
	serviceCategoryId: 1,
	code: "yf-vax",
	name: "Yellow fever vaccination",
	feeCentavos: 12500,
	requiresApproval: true,
}

describe("service schemas", () => {
	it("accepts integer-centavo fees including free services", () => {
		expect(CreateServiceSchema.parse(base)).toMatchObject({
			feeCentavos: 12500,
			requiresApproval: true,
		})
		expect(CreateServiceSchema.parse({ ...base, feeCentavos: 0 }).feeCentavos).toBe(0)
	})

	it("rejects fractional, negative, and overflowing centavo values", () => {
		expect(CreateServiceSchema.safeParse({ ...base, feeCentavos: 1.5 }).success).toBe(false)
		expect(CreateServiceSchema.safeParse({ ...base, feeCentavos: -1 }).success).toBe(false)
		expect(CreateServiceSchema.safeParse({ ...base, feeCentavos: 2_147_483_648 }).success).toBe(
			false
		)
	})

	it("stores the service code uppercase and requires it", () => {
		expect(CreateServiceSchema.parse({ ...base, code: " yf-vax " }).code).toBe("YF-VAX")
		expect(CreateServiceSchema.safeParse({ ...base, code: "" }).success).toBe(false)
		expect(CreateServiceSchema.safeParse({ ...base, code: "X".repeat(33) }).success).toBe(false)
	})

	it("treats the document type as optional and nullable", () => {
		expect(CreateServiceSchema.parse(base).documentType).toBeUndefined()
		expect(CreateServiceSchema.parse({ ...base, documentType: null }).documentType).toBeNull()
		expect(CreateServiceSchema.parse({ ...base, documentType: "icv-record" }).documentType).toBe(
			"icv-record"
		)
		expect(CreateServiceSchema.safeParse({ ...base, documentType: "" }).success).toBe(false)
	})

	it("accepts only document types QSPS can issue (CRT-1)", () => {
		expect(
			CreateServiceSchema.safeParse({ ...base, documentType: "Vaccination Certificate" }).success
		).toBe(false)
		expect(
			UpdateServiceRequestSchema.safeParse({ id: 1, documentType: "Vaccination Certificate" })
				.success
		).toBe(false)
	})

	it("treats auto-issue as optional", () => {
		expect(CreateServiceSchema.parse(base).autoIssue).toBeUndefined()
		expect(CreateServiceSchema.parse({ ...base, autoIssue: false }).autoIssue).toBe(false)
		expect(UpdateServiceRequestSchema.safeParse({ id: 1, autoIssue: false }).success).toBe(true)
	})

	it("requires an update to include at least one editable field", () => {
		expect(UpdateServiceRequestSchema.safeParse({ id: 1 }).success).toBe(false)
		expect(UpdateServiceRequestSchema.safeParse({ id: 1, feeCentavos: 200 }).success).toBe(true)
		expect(UpdateServiceRequestSchema.safeParse({ id: 1, documentType: null }).success).toBe(true)
	})

	it("accepts the service id from the URL path as text", () => {
		expect(UpdateServiceRequestSchema.parse({ id: "7", feeCentavos: 200 }).id).toBe(7)
		expect(SetServiceActiveRequestSchema.parse({ id: "7", isActive: false }).id).toBe(7)
		expect(UpdateServiceRequestSchema.safeParse({ id: "abc", feeCentavos: 200 }).success).toBe(
			false
		)
	})
})
