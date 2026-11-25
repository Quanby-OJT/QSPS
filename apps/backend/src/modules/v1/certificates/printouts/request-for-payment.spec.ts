import { PdfService } from "@/common/pdf/pdf.service"

import { formatPesos } from "./format"
import {
	drawRequestForPayment,
	requestForPaymentRows,
	type RequestForPaymentData,
} from "./request-for-payment"

const data: RequestForPaymentData = {
	referenceNumber: "QSPS-261124-AB12CD",
	clientName: "Juan Dela Cruz",
	printedOn: "2026-11-24",
	items: [
		{ serviceName: "Physical Examination", locationName: "BOQ Manila", feeCentavos: 150000 },
		{ serviceName: "Chest X-ray", locationName: "BOQ Manila", feeCentavos: 35050 },
	],
	totalCentavos: 185050,
}

describe("formatPesos", () => {
	it("writes centavos as pesos with two decimals", () => {
		expect(formatPesos(150000)).toBe("PHP 1,500.00")
		expect(formatPesos(35050)).toBe("PHP 350.50")
		expect(formatPesos(5)).toBe("PHP 0.05")
		expect(formatPesos(0)).toBe("PHP 0.00")
	})

	it("groups thousands", () => {
		expect(formatPesos(123456789)).toBe("PHP 1,234,567.89")
	})
})

describe("requestForPaymentRows", () => {
	it("lists each Service with its Location and fee", () => {
		expect(requestForPaymentRows(data)).toEqual([
			["Physical Examination", "BOQ Manila", "PHP 1,500.00"],
			["Chest X-ray", "BOQ Manila", "PHP 350.50"],
		])
	})
})

describe("drawRequestForPayment", () => {
	const pdfService = new PdfService()

	it("renders a PDF for the cashier", async () => {
		const qrPng = await pdfService.qrPng(data.referenceNumber)
		const pdf = await pdfService.render({ title: "Request for Payment" }, doc =>
			drawRequestForPayment(doc, data, qrPng)
		)
		expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
		expect(pdf.length).toBeGreaterThan(1000)
	})

	it("carries on to a second page when there are many Services", async () => {
		const many: RequestForPaymentData = {
			...data,
			items: Array.from({ length: 60 }, (_, index) => ({
				serviceName: `Service ${index + 1}`,
				locationName: "BOQ Manila",
				feeCentavos: 10000,
			})),
			totalCentavos: 600000,
		}
		const qrPng = await pdfService.qrPng(many.referenceNumber)
		const pdf = await pdfService.render({ title: "Request for Payment" }, doc =>
			drawRequestForPayment(doc, many, qrPng)
		)
		expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
	})
})
