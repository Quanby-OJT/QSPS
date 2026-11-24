import { describe, expect, it } from "vitest"

import {
	DocumentVerificationSchema,
	DocumentVerificationStatusSchema,
} from "./certificates.schema.js"

const verification = {
	documentType: "sanitary-permit",
	documentTitle: "Sanitary Permit",
	documentNumber: "SPM-MNL-2026-000001",
	holderName: "M*** F*** F***",
	issuingLocation: "Manila",
	issuedAt: new Date("2026-11-19T02:00:00.000Z"),
	status: "valid",
	validUntil: "2027-11-18",
	statusChangedAt: null,
}

describe("public verification result (CRT-5)", () => {
	it("knows the expired status besides the stored ones", () => {
		expect(DocumentVerificationStatusSchema.options).toEqual([
			"valid",
			"revoked",
			"superseded",
			"expired",
		])
	})

	it("accepts a valid and an expired document with their valid-until date", () => {
		expect(DocumentVerificationSchema.safeParse(verification).success).toBe(true)
		expect(
			DocumentVerificationSchema.safeParse({ ...verification, status: "expired" }).success
		).toBe(true)
	})

	it("accepts a document that does not expire", () => {
		expect(
			DocumentVerificationSchema.safeParse({ ...verification, validUntil: null }).success
		).toBe(true)
	})

	it("needs the valid-until field, null or a date", () => {
		const { validUntil: _omitted, ...without } = verification
		expect(DocumentVerificationSchema.safeParse(without).success).toBe(false)
	})

	it("refuses a status it does not know", () => {
		expect(
			DocumentVerificationSchema.safeParse({ ...verification, status: "lapsed" }).success
		).toBe(false)
	})
})
