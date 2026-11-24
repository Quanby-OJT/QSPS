import type { IssueContext } from "./document-type"
import { buildHumanRemainsPayload, drawHumanRemains, humanRemains } from "./human-remains"

// 13:00 on Thursday 19 November 2026 in Manila.
const ISSUED = new Date("2026-11-19T05:00:00.000Z")

const answers = {
	"Name of the deceased": "Juan Dela Cruz",
	"Date of death": "2026-11-15",
	"Cause of death": "Cardiac arrest",
	"Embalmed or cremated": "Embalmed",
	"Consignee name": "Maria Dela Cruz",
	"Consignee address": "45 Mabini St, Cebu City",
	"Consignee contact number": "Not answered",
	"Origin": "Manila",
	"Destination": "Cebu",
	"Carrier, flight or vessel": "PR 2105",
	"Date of transport": "2026-11-20",
}

const context: IssueContext = {
	holder: { name: "Maria Dela Cruz", birthDate: null, gender: null, nationality: null },
	serviceName: "Human Remains Transport Clearance",
	locationName: "BOQ Manila",
	issuedAt: ISSUED,
	answers,
}

describe("Human Remains Certificate (CRT-7)", () => {
	it("is its own document type with the HRC prefix, never expires and is stored encrypted", () => {
		expect(humanRemains.type).toBe("human-remains")
		expect(humanRemains.numberPrefix).toBe("HRC")
		expect(humanRemains.sensitive).toBe(true)
		expect(humanRemains.validUntil({})).toBeNull()
	})

	it("holds the deceased, the consignee and the transport, from the answers alone", () => {
		expect(buildHumanRemainsPayload(context)).toEqual({
			holder: { name: "Juan Dela Cruz" },
			deceased: {
				name: "Juan Dela Cruz",
				dateOfDeath: "2026-11-15",
				causeOfDeath: "Cardiac arrest",
				preparation: "Embalmed",
			},
			consignee: {
				name: "Maria Dela Cruz",
				address: "45 Mabini St, Cebu City",
				contactNumber: null,
			},
			transport: {
				origin: "Manila",
				destination: "Cebu",
				carrier: "PR 2105",
				date: "2026-11-20",
			},
			requestedBy: "Maria Dela Cruz",
			serviceName: "Human Remains Transport Clearance",
			dateIssued: "2026-11-19",
			issuingStation: "BOQ Manila",
		})
	})

	it("keeps the deceased's name under holder.name, so public verification masks it", () => {
		const payload = humanRemains.buildPayload(context, {})
		expect((payload.holder as { name: string }).name).toBe("Juan Dela Cruz")
	})

	it.each([
		"Name of the deceased",
		"Date of death",
		"Cause of death",
		"Embalmed or cremated",
		"Consignee name",
		"Consignee address",
		"Origin",
		"Destination",
		"Carrier, flight or vessel",
		"Date of transport",
	])("names the question %s when it was left out", question => {
		expect(() =>
			buildHumanRemainsPayload({ ...context, answers: { ...answers, [question]: "Not answered" } })
		).toThrow(question)
	})

	it("does not need the consignee's contact number", () => {
		expect(() =>
			buildHumanRemainsPayload({
				...context,
				answers: { ...answers, "Consignee contact number": "0917 123 4567" },
			})
		).not.toThrow()
	})

	it("draws every section of the certificate", () => {
		const text: string[] = []
		const doc: object = new Proxy(
			{ page: { margins: { left: 40, right: 40 }, width: 595 }, y: 0 },
			{
				get: (target, key) =>
					key in target
						? Reflect.get(target, key)
						: (...args: unknown[]) => {
								if (typeof args[0] === "string") text.push(args[0])
								return doc
							},
			}
		)
		drawHumanRemains(doc as never, buildHumanRemainsPayload(context), {
			documentNumber: "HRC-MNL-2026-000001",
			status: "valid",
			verifyUrl: "http://localhost:3001/verify/AbCdEfGhIjKlMnOpQrSt_-",
			qrPng: Buffer.from("png"),
		})
		const printed = text.join("\n")
		for (const expected of [
			"Human Remains Certificate",
			"DECEASED",
			"Juan Dela Cruz",
			"Cardiac arrest",
			"CONSIGNEE",
			"45 Mabini St, Cebu City",
			"TRANSPORT",
			"PR 2105",
			"HRC-MNL-2026-000001",
		]) {
			expect(printed).toContain(expected)
		}
	})
})
