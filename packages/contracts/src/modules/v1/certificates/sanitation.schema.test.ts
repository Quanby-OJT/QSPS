import { describe, expect, it } from "vitest"

import {
	DOCUMENT_TYPES,
	IssueDocumentSchema,
	MAX_SHIP_FINDINGS_LENGTH,
	SanitaryPermitDetailsSchema,
	SERVICE_DOCUMENT_TYPES,
	ShipSanitationDetailsSchema,
} from "./certificates.schema.js"

const permit = { validFrom: "2026-12-01", validUntil: "2027-11-30" }
const ship = {
	findings: "Galley, potable water and waste systems inspected; no infestation found.",
	validFrom: "2026-12-01",
	validUntil: "2027-05-31",
}
const vaccination = {
	batchNumber: "YF-24A",
	vaccinatorName: "Dr. Juan Reyes",
	validFrom: "2026-12-01",
}

function problems(
	result: { success: true } | { success: false; error: { issues: { message: string }[] } }
): string[] {
	return result.success ? [] : result.error.issues.map(issue => issue.message)
}

describe("sanitation document types (CRT-5)", () => {
	it("lists both types as document types, and as types a Service can issue", () => {
		for (const type of ["sanitary-permit", "ship-sanitation"]) {
			expect(DOCUMENT_TYPES as readonly string[]).toContain(type)
			expect(SERVICE_DOCUMENT_TYPES as readonly string[]).toContain(type)
		}
	})
})

describe("SanitaryPermitDetailsSchema", () => {
	it("accepts a validity period", () => {
		expect(SanitaryPermitDetailsSchema.safeParse(permit).success).toBe(true)
	})

	it("accepts a permit that ends on the day it starts", () => {
		const result = SanitaryPermitDetailsSchema.safeParse({
			validFrom: "2026-12-01",
			validUntil: "2026-12-01",
		})
		expect(result.success).toBe(true)
	})

	it("requires an end date, because the permit expires", () => {
		expect(SanitaryPermitDetailsSchema.safeParse({ validFrom: "2026-12-01" }).success).toBe(false)
		expect(
			SanitaryPermitDetailsSchema.safeParse({ validFrom: "2026-12-01", validUntil: null }).success
		).toBe(false)
	})

	it("refuses an end date before the start date", () => {
		const result = SanitaryPermitDetailsSchema.safeParse({
			validFrom: "2026-12-01",
			validUntil: "2026-11-30",
		})
		expect(problems(result)).toContain("Valid until cannot be before valid from")
	})
})

describe("ShipSanitationDetailsSchema", () => {
	it("accepts findings and a validity period", () => {
		expect(ShipSanitationDetailsSchema.safeParse(ship).success).toBe(true)
	})

	it("requires the inspection findings, even when only spaces are typed", () => {
		expect(ShipSanitationDetailsSchema.safeParse({ ...ship, findings: "   " }).success).toBe(false)
		expect(problems(ShipSanitationDetailsSchema.safeParse({ ...ship, findings: "" }))).toContain(
			"Enter the inspection findings"
		)
	})

	it("refuses findings that are too long to print", () => {
		const tooLong = "x".repeat(MAX_SHIP_FINDINGS_LENGTH + 1)
		expect(ShipSanitationDetailsSchema.safeParse({ ...ship, findings: tooLong }).success).toBe(
			false
		)
	})

	it("requires an end date that is not before the start date", () => {
		expect(ShipSanitationDetailsSchema.safeParse({ ...ship, validUntil: undefined }).success).toBe(
			false
		)
		expect(
			problems(ShipSanitationDetailsSchema.safeParse({ ...ship, validUntil: "2026-11-30" }))
		).toContain("Valid until cannot be before valid from")
	})
})

describe("IssueDocumentSchema with the sanitation types", () => {
	it("accepts a Sanitary Permit for an item, and fills the other keys with null", () => {
		const result = IssueDocumentSchema.safeParse({ bookingItemId: "7", sanitaryPermit: permit })
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data.bookingItemId).toBe(7)
			expect(result.data.details).toBe(null)
			expect(result.data.exemption).toBe(null)
			expect(result.data.shipSanitation).toBe(null)
			expect(result.data.sanitaryPermit).toEqual(permit)
		}
	})

	it("accepts a Ship Sanitation Certificate for an item", () => {
		const result = IssueDocumentSchema.safeParse({ bookingItemId: 7, shipSanitation: ship })
		expect(result.success).toBe(true)
	})

	it("still accepts the vaccination record on its own", () => {
		expect(IssueDocumentSchema.safeParse({ bookingItemId: 7, details: vaccination }).success).toBe(
			true
		)
	})

	it("refuses two documents at once", () => {
		const both = IssueDocumentSchema.safeParse({
			bookingItemId: 7,
			sanitaryPermit: permit,
			shipSanitation: ship,
		})
		expect(problems(both)).toContain("Enter the details of one document only")

		const mixed = IssueDocumentSchema.safeParse({
			bookingItemId: 7,
			details: vaccination,
			sanitaryPermit: permit,
		})
		expect(mixed.success).toBe(false)
	})

	it("refuses an issue with no details, with the CRT-3 wording", () => {
		const none = IssueDocumentSchema.safeParse({ bookingItemId: 7 })
		expect(problems(none)).toContain(
			"Enter the vaccination details or the exemption details, not both"
		)
	})

	it("refuses a sanitation document whose own details are invalid", () => {
		const result = IssueDocumentSchema.safeParse({
			bookingItemId: 7,
			sanitaryPermit: { validFrom: "2026-12-01", validUntil: "2026-01-01" },
		})
		expect(result.success).toBe(false)
	})
})
