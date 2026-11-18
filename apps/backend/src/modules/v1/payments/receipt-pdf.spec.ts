import { PdfService } from "@/common/pdf/pdf.service"

import { drawReceipt, formatManilaDateTime, formatPesos } from "./receipt-pdf"

describe("receipt PDF", () => {
	it("formats money in pesos with two decimals", () => {
		expect(formatPesos(150000)).toBe("PHP 1,500.00")
		expect(formatPesos(5)).toBe("PHP 0.05")
		expect(formatPesos(0)).toBe("PHP 0.00")
	})

	it("prints the payment time in Manila", () => {
		// 01:30 UTC is 09:30 in Manila.
		expect(formatManilaDateTime(new Date("2026-11-18T01:30:00.000Z"))).toBe(
			"November 18, 2026 at 9:30 AM (Asia/Manila)"
		)
	})

	it("draws every TOR field onto a real PDF", async () => {
		const pdf = new PdfService()
		const qrPng = await pdf.qrPng("http://localhost:3001/receipts/verify/token")
		const lines: string[] = []

		const bytes = await pdf.render({ title: "e-Receipt" }, doc => {
			// Record each piece of text as it is drawn, then draw it as usual.
			const original = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument
			jest.spyOn(doc, "text").mockImplementation(((...args: unknown[]) => {
				lines.push(String(args[0]))
				return original(...args)
			}) as never)

			drawReceipt(doc, {
				receiptNumber: "QSPS-R-261118-000001",
				referenceNumber: "QSPS-261117-AB12CD",
				issuedAt: new Date("2026-11-18T01:30:00.000Z"),
				clientName: "Alex Johnson",
				channelCode: "fake",
				items: [{ serviceName: "Yellow fever vaccination", feeCentavos: 150000 }],
				convenienceFeeCentavos: 0,
				totalCentavos: 150000,
				status: "valid",
				verifyUrl: "http://localhost:3001/receipts/verify/token",
				qrPng,
			})
		})

		expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-")
		expect(lines).toEqual(
			expect.arrayContaining([
				"QSPS-R-261118-000001",
				"QSPS-261117-AB12CD",
				"November 18, 2026 at 9:30 AM (Asia/Manila)",
				"Alex Johnson",
				"fake",
				"PAID",
				"Yellow fever vaccination",
				"PHP 1,500.00",
				"Convenience fee",
				"PHP 0.00",
				"Total paid",
			])
		)
	})
})
