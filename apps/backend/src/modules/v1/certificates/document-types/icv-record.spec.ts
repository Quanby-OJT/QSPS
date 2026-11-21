import { PdfService } from "@/common/pdf/pdf.service"

import { buildIcvPayload, drawIcvRecord, formatCalendarDate, icvRecord } from "./icv-record"
import { documentTypeFor } from "./registry"

const context = {
	holder: { name: "Test Three", birthDate: "2003-07-12", gender: "Male", nationality: "Filipino" },
	serviceName: "Yellow fever vaccination",
	locationName: "BOQ Manila",
	// 16:30 UTC on 18 Nov is 00:30 on 19 Nov in Manila.
	issuedAt: new Date("2026-11-18T16:30:00.000Z"),
}

const details = {
	batchNumber: "YF-24A",
	vaccinatorName: "Dr. Reyes",
	validFrom: "2026-11-29",
	validUntil: null,
	passportOrIdNumber: "P1234567A",
}

describe("icv-record document type", () => {
	it("is registered under its DOMAIN-MODEL name", () => {
		expect(documentTypeFor("icv-record")).toBe(icvRecord)
		expect(documentTypeFor("unknown-type")).toBeUndefined()
		expect(documentTypeFor(null)).toBeUndefined()
	})

	it("copies the holder and the staff-entered details, with the Manila date given", () => {
		expect(buildIcvPayload(context, details)).toEqual({
			holder: {
				name: "Test Three",
				birthDate: "2003-07-12",
				sex: "Male",
				nationality: "Filipino",
				passportOrIdNumber: "P1234567A",
			},
			vaccine: "Yellow fever vaccination",
			dateGiven: "2026-11-19",
			batchNumber: "YF-24A",
			vaccinatorName: "Dr. Reyes",
			validFrom: "2026-11-29",
			validUntil: null,
			issuingStation: "BOQ Manila",
		})
		expect(icvRecord.validUntil(details)).toBeNull()
		expect(icvRecord.validUntil({ ...details, validUntil: "2036-11-29" })).toBe("2036-11-29")
	})

	it("formats calendar dates without shifting the day", () => {
		expect(formatCalendarDate("2026-11-19")).toBe("November 19, 2026")
		expect(formatCalendarDate(null)).toBe("-")
	})

	it("draws every field onto a real PDF", async () => {
		const pdf = new PdfService()
		const qrPng = await pdf.qrPng("http://localhost:3001/verify/token")
		const lines: string[] = []
		const bytes = await pdf.render({ title: "ICV" }, doc => {
			const original = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument
			jest.spyOn(doc, "text").mockImplementation(((...args: unknown[]) => {
				lines.push(String(args[0]))
				return original(...args)
			}) as never)
			drawIcvRecord(doc, buildIcvPayload(context, details), {
				documentNumber: "ICV-MNL-2026-000001",
				status: "valid",
				verifyUrl: "http://localhost:3001/verify/token",
				qrPng,
			})
		})
		expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-")
		expect(lines).toEqual(
			expect.arrayContaining([
				"ICV-MNL-2026-000001",
				"VALID",
				"Test Three",
				"July 12, 2003",
				"P1234567A",
				"Yellow fever vaccination",
				"November 19, 2026",
				"YF-24A",
				"Dr. Reyes",
				"Life of the person",
				"BOQ Manila",
			])
		)
	})
})
