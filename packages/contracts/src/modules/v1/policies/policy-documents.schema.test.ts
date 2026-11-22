import { describe, expect, it } from "vitest"

import {
	ApplicablePoliciesRequestSchema,
	CreatePolicyDocumentSchema,
	PolicyEffectiveDateSchema,
	UpdatePolicyDocumentSchema,
} from "./policy-documents.schema.js"

const valid = {
	title: "  Terms of booking ",
	body: "Arrive 15 minutes early.\n\nBring a valid ID.",
	appliesToAllServices: false,
	serviceIds: [4, 2, 4],
	effectiveFrom: "2026-12-01",
	requiresAcceptance: true,
}

describe("CreatePolicyDocumentSchema (ADM-9)", () => {
	it("trims the text and keeps each listed service once, in order", () => {
		expect(CreatePolicyDocumentSchema.parse(valid)).toEqual({
			...valid,
			title: "Terms of booking",
			serviceIds: [2, 4],
		})
	})

	it("clears the service list when the policy applies to all services", () => {
		expect(
			CreatePolicyDocumentSchema.parse({ ...valid, appliesToAllServices: true }).serviceIds
		).toEqual([])
	})

	it("asks for a service, or all services, on the service list", () => {
		const parsed = CreatePolicyDocumentSchema.safeParse({ ...valid, serviceIds: [] })
		expect(parsed.success).toBe(false)
		if (!parsed.success) {
			expect(parsed.error.issues[0]).toMatchObject({
				path: ["serviceIds"],
				message: "Choose at least one service, or apply it to all services",
			})
		}
	})

	it.each([
		["title", { title: "   " }],
		["body", { body: "" }],
		["title", { title: "x".repeat(201) }],
	])("refuses an empty or too long %s", (_field, change) => {
		expect(CreatePolicyDocumentSchema.safeParse({ ...valid, ...change }).success).toBe(false)
	})
})

describe("PolicyEffectiveDateSchema", () => {
	it.each(["2026-12-01", "2028-02-29"])("accepts %s", value => {
		expect(PolicyEffectiveDateSchema.safeParse(value).success).toBe(true)
	})

	it.each(["2026-02-30", "2026-13-01", "1/12/2026", "2026-12-1"])("refuses %s", value => {
		expect(PolicyEffectiveDateSchema.safeParse(value).success).toBe(false)
	})
})

describe("UpdatePolicyDocumentSchema", () => {
	it("needs the policy's key as well as every field", () => {
		const documentKey = "3f1c2b7e-8a4d-4e5f-9b6a-0c1d2e3f4a5b"
		expect(UpdatePolicyDocumentSchema.parse({ ...valid, documentKey }).documentKey).toBe(
			documentKey
		)
		expect(UpdatePolicyDocumentSchema.safeParse({ ...valid, documentKey: "nope" }).success).toBe(
			false
		)
	})
})

describe("ApplicablePoliciesRequestSchema", () => {
	it("reads the service id from the query string", () => {
		expect(ApplicablePoliciesRequestSchema.parse({ serviceId: "7" })).toEqual({ serviceId: 7 })
		expect(ApplicablePoliciesRequestSchema.safeParse({ serviceId: "x" }).success).toBe(false)
	})
})
