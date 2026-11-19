import { formatDocumentNumber } from "./document-number"

describe("formatDocumentNumber", () => {
	it("uses the type prefix, the Location code, the Manila year and a six-digit counter", () => {
		expect(formatDocumentNumber("ICV", "MNL", new Date("2026-11-19T05:00:00.000Z"), 1)).toBe(
			"ICV-MNL-2026-000001"
		)
	})

	it("takes the year in Manila, not UTC", () => {
		// 16:30 UTC on 31 Dec 2026 is already 1 Jan 2027 in Manila.
		expect(formatDocumentNumber("ICV", "CEB", new Date("2026-12-31T16:30:00.000Z"), 124)).toBe(
			"ICV-CEB-2027-000124"
		)
	})

	it("keeps counting past six digits instead of wrapping", () => {
		expect(formatDocumentNumber("ICV", "mnl", new Date("2026-11-19T05:00:00.000Z"), 1234567)).toBe(
			"ICV-MNL-2026-1234567"
		)
	})
})