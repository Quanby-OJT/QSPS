import { PdfService } from "@/common/pdf/pdf.service"

import { formatCardDate } from "./calendar-date"
import {
	ICV_CARD_FIELDS_MM,
	ICV_CARD_SIZE_MM,
	drawIcvCard,
	icvCardLayout,
	icvCardValues,
	mmToPoints,
	placeOnCard,
} from "./icv-card"
import { buildIcvPayload, icvRecord } from "./icv-record"

const payload = buildIcvPayload(
	{
		holder: {
			name: "Test Three",
			birthDate: "2003-07-12",
			gender: "Male",
			nationality: "Filipino",
		},
		serviceName: "Yellow fever vaccination",
		locationName: "BOQ Manila",
		issuedAt: new Date("2026-11-18T16:30:00.000Z"),
	},
	{
		batchNumber: "YF-24A",
		vaccinatorName: "Dr. Reyes",
		validFrom: "2026-11-29",
		validUntil: null,
		passportOrIdNumber: "P1234567A",
	}
)

describe("icv-record card layout (CRT-3)", () => {
	it("is the print layout of the vaccination record, sized to the card", () => {
		expect(icvRecord.card).toBe(icvCardLayout)
		expect(icvCardLayout.size).toEqual([
			mmToPoints(ICV_CARD_SIZE_MM.width),
			mmToPoints(ICV_CARD_SIZE_MM.height),
		])
	})

	it("converts millimetres to PDF points", () => {
		expect(mmToPoints(25.4)).toBeCloseTo(72)
		expect(mmToPoints(0)).toBe(0)
	})

	it("shifts every position by the Location's offsets", () => {
		const box = ICV_CARD_FIELDS_MM.holderName
		expect(placeOnCard(box, { xMm: 0, yMm: 0 })).toEqual({
			x: mmToPoints(box.x),
			y: mmToPoints(box.y),
		})
		const moved = placeOnCard(box, { xMm: 2, yMm: -1.5 })
		expect(moved.x).toBeCloseTo(mmToPoints(box.x + 2))
		expect(moved.y).toBeCloseTo(mmToPoints(box.y - 1.5))
	})

	it("keeps every field inside the card", () => {
		for (const box of Object.values(ICV_CARD_FIELDS_MM)) {
			expect(box.x + box.width).toBeLessThanOrEqual(ICV_CARD_SIZE_MM.width)
			expect(box.y).toBeLessThan(ICV_CARD_SIZE_MM.height)
		}
	})

	it("prints the values only, formatted like the record", () => {
		expect(icvCardValues(payload, "ICV-MNL-2026-000001")).toEqual({
			holderName: "Test Three",
			birthDate: "12 Jul 2003",
			sex: "Male",
			nationality: "Filipino",
			passportOrIdNumber: "P1234567A",
			vaccine: "Yellow fever vaccination",
			dateGiven: "19 Nov 2026",
			vaccinatorName: "Dr. Reyes",
			batchNumber: "YF-24A",
			validFrom: "29 Nov 2026",
			validUntil: "Life of the person",
			issuingStation: "BOQ Manila",
			documentNumber: "ICV-MNL-2026-000001",
		})
	})

	it("prints dates in the short card form so they fit their boxes", () => {
		expect(formatCardDate("2026-11-23")).toBe("23 Nov 2026")
		expect(formatCardDate("2003-01-05")).toBe("5 Jan 2003")
		expect(formatCardDate(null)).toBe("-")
	})

	it("draws onto one card-sized page with no labels", async () => {
		const pdf = new PdfService()
		const qrPng = await pdf.qrPng("http://localhost:3001/verify/token")
		const lines: string[] = []
		let pages = 1
		const bytes = await pdf.render({ title: "Card", size: icvCardLayout.size, margin: 0 }, doc => {
			doc.on("pageAdded", () => {
				pages += 1
			})
			const original = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument
			jest.spyOn(doc, "text").mockImplementation(((...args: unknown[]) => {
				lines.push(String(args[0]))
				return original(...args)
			}) as never)
			drawIcvCard(
				doc,
				payload,
				{
					documentNumber: "ICV-MNL-2026-000001",
					status: "valid",
					verifyUrl: "http://localhost:3001/verify/token",
					qrPng,
				},
				{ xMm: 1, yMm: 1 }
			)
		})
		expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-")
		expect(pages).toBe(1)
		expect(lines).toEqual(Object.values(icvCardValues(payload, "ICV-MNL-2026-000001")))
		// The card already carries its labels.
		expect(lines).not.toContain("Name")
	})
})