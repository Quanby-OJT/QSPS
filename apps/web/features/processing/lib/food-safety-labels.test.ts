import { describe, expect, it } from "vitest"

import { documentTypeLabel, isSeminarService, validityDocumentType } from "./labels"

describe("food safety documents (CRT-6)", () => {
	it("names the two new documents", () => {
		expect(documentTypeLabel("food-safety-training")).toBe("Food Safety Training Certificate")
		expect(documentTypeLabel("haccp")).toBe("HACCP Certificate")
	})

	it("asks officers for a validity period for sanitation documents and HACCP, but not for anything else", () => {
		expect(validityDocumentType("sanitary-permit")).toBe("sanitary-permit")
		expect(validityDocumentType("ship-sanitation")).toBe("ship-sanitation")
		expect(validityDocumentType("haccp")).toBe("haccp")
		expect(validityDocumentType("food-safety-training")).toBeNull()
		expect(validityDocumentType("icv-record")).toBeNull()
		expect(validityDocumentType(null)).toBeNull()
	})

	it("recognises a seminar Service, whose certificates are issued from the roster", () => {
		expect(isSeminarService("food-safety-training")).toBe(true)
		expect(isSeminarService("haccp")).toBe(false)
		expect(isSeminarService(null)).toBe(false)
	})
})
