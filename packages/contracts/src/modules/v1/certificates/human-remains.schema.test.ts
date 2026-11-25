import { describe, expect, it } from "vitest"

import {
	BiologicalCertificationDetailsSchema,
	BiologicalPermitDetailsSchema,
	DOCUMENT_TYPES,
	HumanRemainsDetailsSchema,
	IssueDocumentSchema,
	SERVICE_DOCUMENT_TYPES,
} from "./certificates.schema.js"

describe("document types (CRT-7)", () => {
	it.each(["human-remains", "biological-certification", "biological-permit"])(
		"lists %s as a document type and as one a Service can issue",
		type => {
			expect(DOCUMENT_TYPES).toContain(type)
			expect(SERVICE_DOCUMENT_TYPES).toContain(type)
		}
	)
})

describe("human remains and biological certification details (CRT-7)", () => {
	it("take nothing from staff: the details come from the client's answers", () => {
		expect(HumanRemainsDetailsSchema.parse({})).toEqual({})
		expect(BiologicalCertificationDetailsSchema.parse({})).toEqual({})
	})

	it("refuse anything typed in, so no detail is printed that was not the client's", () => {
		expect(HumanRemainsDetailsSchema.safeParse({ causeOfDeath: "Illness" }).success).toBe(false)
		expect(BiologicalCertificationDetailsSchema.safeParse({ quantity: "10" }).success).toBe(false)
	})
})

describe("biological permit details (CRT-7)", () => {
	it("accepts a validity period", () => {
		expect(
			BiologicalPermitDetailsSchema.parse({ validFrom: "2026-12-01", validUntil: "2027-11-30" })
		).toEqual({ validFrom: "2026-12-01", validUntil: "2027-11-30" })
	})

	it("refuses an end date before the start date, naming validUntil", () => {
		const result = BiologicalPermitDetailsSchema.safeParse({
			validFrom: "2026-12-01",
			validUntil: "2026-11-30",
		})
		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.path).toEqual(["validUntil"])
	})

	it("refuses a missing date", () => {
		expect(BiologicalPermitDetailsSchema.safeParse({ validFrom: "2026-12-01" }).success).toBe(false)
	})
})

describe("issuing a human remains or biological document (CRT-7)", () => {
	const permit = { validFrom: "2026-12-01", validUntil: "2027-11-30" }

	it("accepts the details of exactly one of the three new types", () => {
		expect(IssueDocumentSchema.parse({ bookingItemId: 7, humanRemains: {} })).toMatchObject({
			bookingItemId: 7,
			humanRemains: {},
			biologicalCertification: null,
			biologicalPermit: null,
			details: null,
		})
		expect(
			IssueDocumentSchema.parse({ bookingItemId: 7, biologicalCertification: {} })
		).toMatchObject({ biologicalCertification: {}, humanRemains: null })
		expect(IssueDocumentSchema.parse({ bookingItemId: 7, biologicalPermit: permit })).toMatchObject(
			{ biologicalPermit: permit }
		)
	})

	it("refuses a request with none, or with two kinds of details", () => {
		expect(IssueDocumentSchema.safeParse({ bookingItemId: 7 }).success).toBe(false)
		expect(
			IssueDocumentSchema.safeParse({
				bookingItemId: 7,
				humanRemains: {},
				biologicalPermit: permit,
			}).success
		).toBe(false)
		expect(
			IssueDocumentSchema.safeParse({
				bookingItemId: 7,
				humanRemains: {},
				haccp: permit,
			}).success
		).toBe(false)
	})

	it("refuses a permit with an end date before its start", () => {
		expect(
			IssueDocumentSchema.safeParse({
				bookingItemId: 7,
				biologicalPermit: { validFrom: "2026-12-01", validUntil: "2026-11-30" },
			}).success
		).toBe(false)
	})
})
