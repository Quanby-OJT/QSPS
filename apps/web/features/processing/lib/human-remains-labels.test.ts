import { describe, expect, it } from "vitest"

import {
	confirmationDocumentType,
	documentTypeLabel,
	isSeminarService,
	sanitationDocumentType,
	validityDocumentType,
} from "./labels"

describe("human remains and biological documents (CRT-7)", () => {
	it("names the three new documents", () => {
		expect(documentTypeLabel("human-remains")).toBe("Human Remains Certificate")
		expect(documentTypeLabel("biological-certification")).toBe("Biological Substance Certification")
		expect(documentTypeLabel("biological-permit")).toBe("Biological Substance Permit")
	})

	it("asks officers for nothing when issuing a Human Remains Certificate or a Biological Substance Certification", () => {
		expect(confirmationDocumentType("human-remains")).toBe("human-remains")
		expect(confirmationDocumentType("biological-certification")).toBe("biological-certification")
		expect(confirmationDocumentType("biological-permit")).toBeNull()
		expect(confirmationDocumentType("haccp")).toBeNull()
		expect(confirmationDocumentType("icv-record")).toBeNull()
		expect(confirmationDocumentType(null)).toBeNull()
	})

	it("asks officers for a validity period for a Biological Substance Permit", () => {
		expect(validityDocumentType("biological-permit")).toBe("biological-permit")
		expect(validityDocumentType("human-remains")).toBeNull()
		expect(validityDocumentType("biological-certification")).toBeNull()
	})

	it("keeps the Biological Substance Permit out of the sanitation documents", () => {
		expect(sanitationDocumentType("biological-permit")).toBeNull()
	})

	it("does not treat the new documents as seminars", () => {
		expect(isSeminarService("human-remains")).toBe(false)
		expect(isSeminarService("biological-certification")).toBe(false)
		expect(isSeminarService("biological-permit")).toBe(false)
	})
})
