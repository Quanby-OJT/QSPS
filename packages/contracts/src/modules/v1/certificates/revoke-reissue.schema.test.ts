import { describe, expect, it } from "vitest"

import { ReissueDocumentSchema, RevokeDocumentSchema } from "./certificates.schema.js"

const details = { batchNumber: "YF-25B", vaccinatorName: "Dr. Juan Reyes", validFrom: "2026-11-24" }
const exemption = { reason: "Egg allergy", physicianName: "Dr. Santos", validFrom: "2026-11-24" }

describe("revoke and reissue (CRT-8)", () => {
	it("needs a reason to revoke, and trims it", () => {
		expect(RevokeDocumentSchema.parse({ documentId: "6", reason: "  Wrong batch  " })).toEqual({
			documentId: 6,
			reason: "Wrong batch",
		})
		expect(RevokeDocumentSchema.safeParse({ documentId: 6, reason: "   " }).success).toBe(false)
	})

	it("refuses a reason over 500 characters", () => {
		expect(RevokeDocumentSchema.safeParse({ documentId: 6, reason: "x".repeat(501) }).success).toBe(
			false
		)
	})

	it("reissues with exactly one of the vaccination details or the exemption", () => {
		expect(ReissueDocumentSchema.safeParse({ documentId: 8, reason: "Fix", details }).success).toBe(
			true
		)
		expect(
			ReissueDocumentSchema.safeParse({ documentId: 8, reason: "Fix", exemption }).success
		).toBe(true)
		expect(ReissueDocumentSchema.safeParse({ documentId: 8, reason: "Fix" }).success).toBe(false)
		expect(
			ReissueDocumentSchema.safeParse({ documentId: 8, reason: "Fix", details, exemption }).success
		).toBe(false)
	})

	it("needs a reason to reissue", () => {
		expect(ReissueDocumentSchema.safeParse({ documentId: 8, reason: "", details }).success).toBe(
			false
		)
	})
})
