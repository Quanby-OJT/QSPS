import type { IssueContext, PdfExtras } from "./document-type"
import {
	buildFoodSafetyTrainingPayload,
	drawFoodSafetyTraining,
	foodSafetyTraining,
	manilaTimeOf,
} from "./food-safety-training"

// 14:00 to 17:00 on Wednesday 25 November 2026 in Manila.
const STARTS = new Date("2026-11-25T06:00:00.000Z")
const ENDS = new Date("2026-11-25T09:00:00.000Z")
// 13:00 on Thursday 19 November 2026 in Manila.
const ISSUED = new Date("2026-11-19T05:00:00.000Z")

const context: IssueContext = {
	holder: { name: "Test Three", birthDate: "2003-07-12", gender: "Male", nationality: "Filipino" },
	serviceName: "Basic Hygiene and Sanitation Seminar",
	locationName: "BOQ Bacolod",
	issuedAt: ISSUED,
	session: { startsAt: STARTS, endsAt: ENDS },
	answers: {
		"Establishment or employer": "Mercado Fresh Foods",
		"Position or role": "Kitchen staff",
	},
}

const extras: PdfExtras = {
	documentNumber: "FST-BCD-2026-000001",
	status: "valid",
	verifyUrl: "http://localhost:3001/verify/AbCdEfGhIjKlMnOpQrSt_-",
	qrPng: Buffer.from("png"),
}

describe("Food Safety Training Certificate (CRT-6)", () => {
	it("is its own document type with the FST prefix, and never expires", () => {
		expect(foodSafetyTraining.type).toBe("food-safety-training")
		expect(foodSafetyTraining.numberPrefix).toBe("FST")
		expect(foodSafetyTraining.validUntil(undefined)).toBeNull()
	})

	it("names the participant, the seminar and the session in Manila time", () => {
		expect(buildFoodSafetyTrainingPayload(context)).toEqual({
			holder: { name: "Test Three" },
			employer: "Mercado Fresh Foods",
			position: "Kitchen staff",
			serviceName: "Basic Hygiene and Sanitation Seminar",
			sessionDate: "2026-11-25",
			sessionStart: "14:00",
			sessionEnd: "17:00",
			venue: "BOQ Bacolod",
			dateIssued: "2026-11-19",
			issuingStation: "BOQ Bacolod",
		})
	})

	it("leaves the employer and position out when the client did not answer", () => {
		const payload = buildFoodSafetyTrainingPayload({
			...context,
			answers: { "Establishment or employer": "Not answered" },
		})
		expect(payload.employer).toBeNull()
		expect(payload.position).toBeNull()
	})

	it("still issues when the questionnaire has no answers at all", () => {
		const payload = buildFoodSafetyTrainingPayload({ ...context, answers: undefined })
		expect(payload.employer).toBeNull()
		expect(payload.holder.name).toBe("Test Three")
	})

	it("needs the session it was booked into", () => {
		expect(() => buildFoodSafetyTrainingPayload({ ...context, session: undefined })).toThrow(
			"seminar session"
		)
	})

	it("stores the participant under holder.name, so public verification masks it like any name", () => {
		const payload = foodSafetyTraining.buildPayload(context, undefined)
		expect((payload.holder as { name: string }).name).toBe("Test Three")
	})

	it("formats Manila time of day on a 24-hour clock", () => {
		expect(manilaTimeOf(STARTS)).toBe("14:00")
		expect(manilaTimeOf(new Date("2026-11-24T16:30:00.000Z"))).toBe("00:30")
	})

	it("draws the certificate with the participant, the seminar and the QR code", () => {
		const text: string[] = []
		let images = 0
		const doc: Record<string, unknown> = {
			page: { margins: { left: 40, right: 40 }, width: 595 },
			y: 0,
			image: () => {
				images += 1
				return doc
			},
		}
		for (const method of [
			"font",
			"fontSize",
			"fillColor",
			"moveTo",
			"lineTo",
			"lineWidth",
			"strokeColor",
			"stroke",
		]) {
			doc[method] = () => doc
		}
		doc.text = (value: string) => {
			text.push(value)
			return doc
		}

		drawFoodSafetyTraining(doc as never, buildFoodSafetyTrainingPayload(context) as never, extras)

		expect(images).toBe(1)
		expect(text).toContain("Food Safety Training Certificate")
		expect(text).toContain("Test Three")
		expect(text).toContain("Basic Hygiene and Sanitation Seminar")
		expect(text).toContain("14:00 - 17:00")
		expect(text).toContain("FST-BCD-2026-000001")
	})
})
