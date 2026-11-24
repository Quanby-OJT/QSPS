import type { PdfDocument } from "@/common/pdf/pdf.service"

import { formatCalendarDate } from "./calendar-date"
import type { IssueContext, PdfExtras } from "./document-type"
import { MissingAnswerError } from "./questionnaire-answers"
import {
	buildShipSanitationPayload,
	drawShipSanitation,
	SHIP_SANITATION_QUESTIONS as Q,
	shipSanitation,
} from "./ship-sanitation"

const answers = {
	[Q.vesselName]: "MV Pioneer",
	[Q.vesselType]: "Cargo ship",
	[Q.registryNumber]: "IMO 9876543",
	[Q.registryPort]: "Panama",
	[Q.grossTonnage]: "42,000",
	[Q.masterName]: "Capt. Reyes",
	[Q.lastPortOfCall]: "Singapore",
}

const context: IssueContext = {
	holder: { name: "Juan Dela Cruz", birthDate: null, gender: null, nationality: null },
	serviceName: "Ship Sanitation Certificate",
	locationName: "Port of Manila",
	issuedAt: new Date("2026-12-01T03:00:00Z"),
	answers,
}
const details = {
	findings: "Galley and potable water system satisfactory. No evidence of infestation.",
	validFrom: "2026-12-01",
	validUntil: "2027-05-31",
}

const extras: PdfExtras = {
	documentNumber: "SSC-MNL-2026-000001",
	status: "valid",
	verifyUrl: "https://qsps.example/verify/AbCdEfGhIjKlMnOpQrSt_-",
	qrPng: Buffer.from(""),
}

/** A PDF document that draws nothing and remembers every text it was asked to write. */
function recordingDoc() {
	const texts: string[] = []
	const target: Record<string, unknown> = {
		page: { width: 595, margins: { left: 50, right: 50 } },
		y: 100,
	}
	const doc: unknown = new Proxy(target, {
		get(object, property) {
			if (typeof property === "string" && property in object) return object[property]
			if (property === "text") {
				return (value: string) => {
					texts.push(value)
					return doc
				}
			}
			return () => doc
		},
	})
	return { doc: doc as PdfDocument, texts }
}

describe("ship sanitation certificate (CRT-5)", () => {
	it("is registered as ship-sanitation with its own number series", () => {
		expect(shipSanitation.type).toBe("ship-sanitation")
		expect(shipSanitation.title).toBe("Ship Sanitation Certificate")
		expect(shipSanitation.numberPrefix).toBe("SSC")
	})

	it("builds the payload from the answers, the findings and the validity dates", () => {
		const payload = buildShipSanitationPayload(context, details)
		expect(payload).toEqual({
			holder: { name: "MV Pioneer" },
			vesselType: "Cargo ship",
			registryNumber: "IMO 9876543",
			registryPort: "Panama",
			grossTonnage: "42,000",
			masterName: "Capt. Reyes",
			lastPortOfCall: "Singapore",
			findings: details.findings,
			serviceName: "Ship Sanitation Certificate",
			dateIssued: "2026-12-01",
			validFrom: "2026-12-01",
			validUntil: "2027-05-31",
			issuingStation: "Port of Manila",
		})
	})

	it("does not copy the client's own profile into the payload", () => {
		expect(JSON.stringify(buildShipSanitationPayload(context, details))).not.toContain(
			"Juan Dela Cruz"
		)
	})

	it("treats type, tonnage, master and last port as optional", () => {
		const bare = {
			[Q.vesselName]: "MV Pioneer",
			[Q.registryNumber]: "IMO 9876543",
			[Q.registryPort]: "Panama",
		}
		const payload = buildShipSanitationPayload({ ...context, answers: bare }, details)
		expect(payload.vesselType).toBeNull()
		expect(payload.grossTonnage).toBeNull()
		expect(payload.masterName).toBeNull()
		expect(payload.lastPortOfCall).toBeNull()
	})

	it.each([Q.vesselName, Q.registryNumber, Q.registryPort])(
		"cannot be issued without an answer to %s",
		question => {
			const missing = { ...answers, [question]: "Not answered" }
			expect(() => buildShipSanitationPayload({ ...context, answers: missing }, details)).toThrow(
				MissingAnswerError
			)
			expect(() => buildShipSanitationPayload({ ...context, answers: missing }, details)).toThrow(
				question
			)
		}
	)

	it("expires on the last day of validity, which is what documents.valid_until stores", () => {
		expect(shipSanitation.validUntil(details)).toBe("2027-05-31")
	})

	it("draws the vessel, the findings, the number and the expiry date", () => {
		const payload = buildShipSanitationPayload(context, details)
		const { doc, texts } = recordingDoc()
		drawShipSanitation(doc, payload, extras)

		expect(texts).toContain("Ship Sanitation Certificate")
		expect(texts).toContain("MV Pioneer")
		expect(texts).toContain("IMO 9876543")
		expect(texts).toContain(details.findings)
		expect(texts).toContain("SSC-MNL-2026-000001")
		expect(texts).toContain(formatCalendarDate("2027-05-31"))
	})
})
