import type { PdfDocument } from "@/common/pdf/pdf.service"

import { formatCalendarDate } from "./calendar-date"
import type { IssueContext, PdfExtras } from "./document-type"
import { MissingAnswerError } from "./questionnaire-answers"
import {
	buildSanitaryPermitPayload,
	drawSanitaryPermit,
	SANITARY_PERMIT_QUESTIONS as Q,
	sanitaryPermit,
} from "./sanitary-permit"

const answers = {
	[Q.establishmentName]: "Mabuhay Bakery",
	[Q.establishmentType]: "Bakery",
	[Q.ownerName]: "Maria Santos",
	[Q.address]: "12 Rizal Street, Barangay 1, Manila",
	[Q.contactNumber]: "0917 123 4567",
}

const context: IssueContext = {
	holder: { name: "Juan Dela Cruz", birthDate: null, gender: null, nationality: null },
	serviceName: "Sanitary Permit",
	locationName: "Port of Manila",
	// 11:00 on 1 December 2026 in Manila.
	issuedAt: new Date("2026-12-01T03:00:00Z"),
	answers,
}
const details = { validFrom: "2026-12-01", validUntil: "2027-11-30" }

const extras: PdfExtras = {
	documentNumber: "SPM-MNL-2026-000001",
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

describe("sanitary permit (CRT-5)", () => {
	it("is registered as sanitary-permit with its own number series", () => {
		expect(sanitaryPermit.type).toBe("sanitary-permit")
		expect(sanitaryPermit.title).toBe("Sanitary Permit")
		expect(sanitaryPermit.numberPrefix).toBe("SPM")
	})

	it("builds the payload from the questionnaire answers and the officer's validity dates", () => {
		const payload = buildSanitaryPermitPayload(context, details)
		expect(payload).toEqual({
			holder: { name: "Mabuhay Bakery" },
			establishmentType: "Bakery",
			ownerName: "Maria Santos",
			address: "12 Rizal Street, Barangay 1, Manila",
			contactNumber: "0917 123 4567",
			serviceName: "Sanitary Permit",
			dateIssued: "2026-12-01",
			validFrom: "2026-12-01",
			validUntil: "2027-11-30",
			issuingStation: "Port of Manila",
		})
	})

	it("does not copy the client's own profile into the payload", () => {
		expect(JSON.stringify(buildSanitaryPermitPayload(context, details))).not.toContain(
			"Juan Dela Cruz"
		)
	})

	it("treats the contact number as optional", () => {
		const payload = buildSanitaryPermitPayload(
			{ ...context, answers: { ...answers, [Q.contactNumber]: "Not answered" } },
			details
		)
		expect(payload.contactNumber).toBeNull()
	})

	it.each([Q.establishmentName, Q.establishmentType, Q.ownerName, Q.address])(
		"cannot be issued without an answer to %s",
		question => {
			const missing = { ...answers, [question]: "Not answered" }
			expect(() => buildSanitaryPermitPayload({ ...context, answers: missing }, details)).toThrow(
				MissingAnswerError
			)
			expect(() => buildSanitaryPermitPayload({ ...context, answers: missing }, details)).toThrow(
				question
			)
		}
	)

	it("cannot be issued when no questionnaire was answered at all", () => {
		expect(() => buildSanitaryPermitPayload({ ...context, answers: undefined }, details)).toThrow(
			MissingAnswerError
		)
	})

	it("expires on the last day of validity, which is what documents.valid_until stores", () => {
		expect(sanitaryPermit.validUntil(details)).toBe("2027-11-30")
	})

	it("draws the establishment, the number and the expiry date", () => {
		const payload = buildSanitaryPermitPayload(context, details)
		const { doc, texts } = recordingDoc()
		drawSanitaryPermit(doc, payload, extras)

		expect(texts).toContain("Sanitary Permit")
		expect(texts).toContain("Mabuhay Bakery")
		expect(texts).toContain("SPM-MNL-2026-000001")
		expect(texts).toContain(formatCalendarDate("2027-11-30"))
		expect(texts.some(text => text.includes("https://qsps.example/verify/"))).toBe(true)
	})

	it("draws through the registry entry too", () => {
		const payload = buildSanitaryPermitPayload(context, details)
		const { doc, texts } = recordingDoc()
		sanitaryPermit.draw(doc, { ...payload }, extras)
		expect(texts).toContain("Mabuhay Bakery")
	})
})
