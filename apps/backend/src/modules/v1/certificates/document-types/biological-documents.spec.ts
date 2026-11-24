import {
	biologicalCertification,
	buildBiologicalCertificationPayload,
	drawBiologicalCertification,
} from "./biological-certification"
import {
	biologicalPermit,
	buildBiologicalPermitPayload,
	drawBiologicalPermit,
} from "./biological-permit"
import type { IssueContext, PdfExtras } from "./document-type"

// 13:00 on Thursday 19 November 2026 in Manila.
const ISSUED = new Date("2026-11-19T05:00:00.000Z")

const answers = {
	"Substance or specimen": "Human blood samples",
	"Quantity": "20 vials, 5 ml each",
	"Origin": "Manila, Philippines",
	"Destination": "Singapore",
	"Sender or shipper": "Philippine General Hospital",
	"Consignee": "Not answered",
	"Purpose": "Not answered",
}

const context: IssueContext = {
	holder: { name: "Ana Reyes", birthDate: null, gender: null, nationality: null },
	serviceName: "Biological Substance Certification",
	locationName: "BOQ Manila",
	issuedAt: ISSUED,
	answers,
}
const permitDetails = { validFrom: "2026-12-01", validUntil: "2027-11-30" }

const extras: PdfExtras = {
	documentNumber: "BCT-MNL-2026-000001",
	status: "valid",
	verifyUrl: "http://localhost:3001/verify/AbCdEfGhIjKlMnOpQrSt_-",
	qrPng: Buffer.from("png"),
}

/** A PDF document that draws nothing and remembers every text it was asked to write. */
function recordingDoc() {
	const texts: string[] = []
	const doc: object = new Proxy(
		{ page: { margins: { left: 40, right: 40 }, width: 595 }, y: 0 },
		{
			get: (target, key) =>
				key in target
					? Reflect.get(target, key)
					: (...args: unknown[]) => {
							if (typeof args[0] === "string") texts.push(args[0])
							return doc
						},
		}
	)
	return { doc, texts }
}

describe("Biological Substance Certification (CRT-7)", () => {
	it("is its own document type with the BCT prefix, never expires and is stored encrypted", () => {
		expect(biologicalCertification.type).toBe("biological-certification")
		expect(biologicalCertification.numberPrefix).toBe("BCT")
		expect(biologicalCertification.sensitive).toBe(true)
		expect(biologicalCertification.validUntil({})).toBeNull()
	})

	it("holds the substance, quantity, origin and destination, from the answers alone", () => {
		expect(buildBiologicalCertificationPayload(context)).toEqual({
			holder: { name: "Ana Reyes" },
			substance: "Human blood samples",
			quantity: "20 vials, 5 ml each",
			origin: "Manila, Philippines",
			destination: "Singapore",
			sender: "Philippine General Hospital",
			consignee: null,
			purpose: null,
			serviceName: "Biological Substance Certification",
			dateIssued: "2026-11-19",
			issuingStation: "BOQ Manila",
		})
	})

	it("keeps the applicant under holder.name, so public verification masks it", () => {
		const payload = biologicalCertification.buildPayload(context, {})
		expect((payload.holder as { name: string }).name).toBe("Ana Reyes")
	})

	it.each(["Substance or specimen", "Quantity", "Origin", "Destination"])(
		"names the question %s when it was left out",
		question => {
			expect(() =>
				buildBiologicalCertificationPayload({
					...context,
					answers: { ...answers, [question]: "Not answered" },
				})
			).toThrow(question)
		}
	)

	it("prints the substance, quantity, origin and destination", () => {
		const { doc, texts } = recordingDoc()
		drawBiologicalCertification(doc as never, buildBiologicalCertificationPayload(context), extras)
		const printed = texts.join("\n")
		for (const expected of [
			"Biological Substance Certification",
			"SUBSTANCE",
			"Human blood samples",
			"20 vials, 5 ml each",
			"Manila, Philippines",
			"Singapore",
			"BCT-MNL-2026-000001",
		]) {
			expect(printed).toContain(expected)
		}
	})
})

describe("Biological Substance Permit (CRT-7)", () => {
	it("is its own document type with the BPM prefix, valid until the officer's end date, stored encrypted", () => {
		expect(biologicalPermit.type).toBe("biological-permit")
		expect(biologicalPermit.numberPrefix).toBe("BPM")
		expect(biologicalPermit.sensitive).toBe(true)
		expect(biologicalPermit.validUntil(permitDetails)).toBe("2027-11-30")
	})

	it("holds the same substance details plus the validity the officer entered", () => {
		expect(
			buildBiologicalPermitPayload(
				{ ...context, serviceName: "Biological Substance Permit" },
				permitDetails
			)
		).toEqual({
			holder: { name: "Ana Reyes" },
			substance: "Human blood samples",
			quantity: "20 vials, 5 ml each",
			origin: "Manila, Philippines",
			destination: "Singapore",
			sender: "Philippine General Hospital",
			consignee: null,
			purpose: null,
			serviceName: "Biological Substance Permit",
			dateIssued: "2026-11-19",
			issuingStation: "BOQ Manila",
			validFrom: "2026-12-01",
			validUntil: "2027-11-30",
		})
	})

	it.each(["Substance or specimen", "Quantity", "Origin", "Destination"])(
		"names the question %s when it was left out",
		question => {
			expect(() =>
				buildBiologicalPermitPayload(
					{ ...context, answers: { ...answers, [question]: "Not answered" } },
					permitDetails
				)
			).toThrow(question)
		}
	)

	it("prints the validity and says when the permit expires", () => {
		const { doc, texts } = recordingDoc()
		drawBiologicalPermit(doc as never, buildBiologicalPermitPayload(context, permitDetails), {
			...extras,
			documentNumber: "BPM-MNL-2026-000001",
		})
		const printed = texts.join("\n")
		for (const expected of [
			"Biological Substance Permit",
			"Human blood samples",
			"Valid until",
			"valid until",
			"BPM-MNL-2026-000001",
		]) {
			expect(printed).toContain(expected)
		}
	})
})
