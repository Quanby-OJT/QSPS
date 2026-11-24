import type { IssueContext } from "./document-type"
import { buildHaccpPayload, haccp } from "./haccp"

// 09:00 on Wednesday 25 November 2026 in Manila.
const AUDIT = new Date("2026-11-25T01:00:00.000Z")
// 13:00 on Thursday 19 November 2026 in Manila.
const ISSUED = new Date("2026-11-19T05:00:00.000Z")

const context: IssueContext = {
	holder: { name: "Test Three", birthDate: null, gender: null, nationality: null },
	serviceName: "GMP-HACCP Audit",
	locationName: "BOQ Bacolod",
	issuedAt: ISSUED,
	session: { startsAt: AUDIT, endsAt: new Date("2026-11-25T04:00:00.000Z") },
	answers: {
		"Establishment name": "Mercado Fresh Foods",
		"Products or processes to be audited": "Frozen seafood processing",
		"Owner or operator": "Ana Reyes",
		"Business address": "12 Rizal St, Bacolod",
		"Contact number": "Not answered",
	},
}
const details = { validFrom: "2026-12-01", validUntil: "2027-11-30" }

describe("HACCP Certificate (CRT-6)", () => {
	it("is its own document type with the HCP prefix, valid until the officer's end date", () => {
		expect(haccp.type).toBe("haccp")
		expect(haccp.numberPrefix).toBe("HCP")
		expect(haccp.validUntil(details)).toBe("2027-11-30")
	})

	it("names the establishment and the validity, from the answers and the officer", () => {
		expect(buildHaccpPayload(context, details)).toEqual({
			holder: { name: "Mercado Fresh Foods" },
			productsOrProcesses: "Frozen seafood processing",
			ownerName: "Ana Reyes",
			address: "12 Rizal St, Bacolod",
			contactNumber: null,
			serviceName: "GMP-HACCP Audit",
			auditDate: "2026-11-25",
			dateIssued: "2026-11-19",
			validFrom: "2026-12-01",
			validUntil: "2027-11-30",
			issuingStation: "BOQ Bacolod",
		})
	})

	it("keeps the establishment under holder.name, so public verification masks it", () => {
		const payload = haccp.buildPayload(context, details)
		expect((payload.holder as { name: string }).name).toBe("Mercado Fresh Foods")
	})

	it("leaves the audit date out when the slot is unknown", () => {
		expect(buildHaccpPayload({ ...context, session: undefined }, details).auditDate).toBeNull()
	})

	it.each([
		"Establishment name",
		"Products or processes to be audited",
		"Owner or operator",
		"Business address",
	])("names the question %s when it was left out", question => {
		expect(() =>
			buildHaccpPayload(
				{ ...context, answers: { ...context.answers, [question]: "Not answered" } },
				details
			)
		).toThrow(question)
	})
})
