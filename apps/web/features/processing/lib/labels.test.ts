import { describe, expect, it } from "vitest"

import {
	allowsExemption,
	canDecideApproval,
	canOpen,
	canOverride,
	correctionsFromRows,
	documentTypeLabel,
	itemStatusLabel,
	needsIssuing,
	outcomeLabel,
	printCountLabel,
} from "./labels"

describe("processing labels", () => {
	it("names every item status in plain words", () => {
		expect(itemStatusLabel("checked_in")).toBe("Checked in")
		expect(itemStatusLabel("pending_head_approval")).toBe("Awaiting head approval")
		expect(outcomeLabel("returned")).toBe("Returned for correction")
	})

	it("lets staff open only checked-in or returned items", () => {
		expect(canOpen("checked_in")).toBe(true)
		expect(canOpen("returned")).toBe(true)
		expect(canOpen("booked")).toBe(false)
		expect(canOpen("in_assessment")).toBe(false)
		expect(canOpen("cleared")).toBe(false)
	})
})

describe("correctionsFromRows", () => {
	it("drops blank rows and trims what is left", () => {
		expect(
			correctionsFromRows([
				{ field: " Birth date ", value: " 1990-02-01 " },
				{ field: "", value: "ignored" },
				{ field: "   ", value: "" },
			])
		).toEqual({ "Birth date": "1990-02-01" })
	})

	it("keeps the last value when a field is repeated", () => {
		expect(
			correctionsFromRows([
				{ field: "Name", value: "Juan" },
				{ field: "Name", value: "Juan Dela Cruz" },
			])
		).toEqual({ Name: "Juan Dela Cruz" })
	})
})

describe("head approval labels (PRC-3)", () => {
	it("names the head's decisions apart from the officer's", () => {
		expect(outcomeLabel("cleared", "assessment")).toBe("Cleared")
		expect(outcomeLabel("cleared", "approval")).toBe("Approved by head")
		expect(outcomeLabel("returned", "approval")).toBe("Sent back by head")
		expect(outcomeLabel("cleared", "override")).toBe("Overridden to cleared")
	})

	it("offers approval only for pending items and override only for rejected ones", () => {
		expect(canDecideApproval("pending_head_approval")).toBe(true)
		expect(canDecideApproval("cleared")).toBe(false)
		expect(canOverride("rejected")).toBe(true)
		expect(canOverride("pending_head_approval")).toBe(false)
		expect(canOverride("issued")).toBe(false)
	})

	it("names document types and print counts (CRT-3)", () => {
		expect(documentTypeLabel("medical-exemption")).toBe("Medical Exemption Certificate")
		expect(documentTypeLabel("icv-record")).toBe("International Certificate of Vaccination")
		expect(documentTypeLabel("legacy-type")).toBe("legacy-type")
		expect(printCountLabel(0)).toBe("Not printed yet")
		expect(printCountLabel(1)).toBe("Printed once")
		expect(printCountLabel(3)).toBe("Printed 3 times")
	})

	it("offers an exemption only for vaccinations (CRT-3)", () => {
		expect(allowsExemption("icv-record")).toBe(true)
		expect(allowsExemption(null)).toBe(false)
	})

	it("asks for issuing only on a cleared item that has no document yet", () => {
		const service = { documentType: "icv-record" }
		expect(needsIssuing({ status: "cleared", service, document: null })).toBe(true)
		expect(needsIssuing({ status: "cleared", service, document: { id: 1 } })).toBe(false)
		expect(needsIssuing({ status: "issued", service, document: null })).toBe(false)
		expect(
			needsIssuing({ status: "cleared", service: { documentType: null }, document: null })
		).toBe(false)
	})
})
