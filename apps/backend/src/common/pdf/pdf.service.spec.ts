import { PdfService } from "./pdf.service"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe("PdfService", () => {
	const pdf = new PdfService()

	it("renders what the callback draws into PDF bytes", async () => {
		const draw = jest.fn((doc: PDFKit.PDFDocument) => {
			doc.text("Hello")
		})

		const bytes = await pdf.render({ title: "Test" }, draw)

		expect(draw).toHaveBeenCalledTimes(1)
		expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-")
		expect(bytes.subarray(-6).toString("latin1")).toContain("%%EOF")
	})

	it("makes a QR code as a PNG", async () => {
		const png = await pdf.qrPng("https://example.test/receipts/verify/abc")

		expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE)
	})
})
