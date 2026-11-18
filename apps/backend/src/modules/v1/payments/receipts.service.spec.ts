import { NotFoundException } from "@nestjs/common"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { PdfService } from "@/common/pdf/pdf.service"

import { drawReceipt } from "./receipt-pdf"
import { ReceiptService } from "./receipts.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options: { message: string }
		) {
			super(options.message)
		}
	},
}))
jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn() },
}))
jest.mock("@/config/env.config", () => ({
	env: { APP_WEB_URL: "http://localhost:3001" },
}))
jest.mock("./receipt-pdf", () => ({
	drawReceipt: jest.fn(),
}))

const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-"

/** Each `select` resolves to the next entry, however the query is finished. */
function queueSelects(...results: unknown[][]) {
	const queue = [...results]
	jest.mocked(db.select).mockImplementation((() => {
		const rows = queue.shift() ?? []
		const chain: Record<string, unknown> = {
			from: () => chain,
			innerJoin: () => chain,
			where: () => chain,
			orderBy: () => Promise.resolve(rows),
			limit: () => Promise.resolve(rows),
		}
		return chain
	}) as never)
}

const receiptRow = {
	receiptId: 7,
	receiptNumber: "QSPS-R-261118-000090",
	verificationToken: TOKEN,
	issuedAt: new Date("2026-11-18T01:30:00.000Z"),
	amountCentavos: 150000,
	convenienceFeeCentavos: 0,
	channelCode: "fake",
	paymentStatus: "succeeded",
	bookingId: 31,
	referenceNumber: "QSPS-261117-AB12CD",
	clientId: "client-1",
	clientName: "Alex Johnson",
}

describe("ReceiptService", () => {
	let audit: { record: jest.Mock }
	let pdf: { render: jest.Mock; qrPng: jest.Mock }
	let service: ReceiptService

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		pdf = {
			qrPng: jest.fn().mockResolvedValue(Buffer.from("png")),
			// Runs the drawing callback so drawReceipt receives its data.
			render: jest.fn(async (_info: unknown, draw: (doc: unknown) => void) => {
				draw({})
				return Buffer.from("%PDF-1.3")
			}),
		}
		service = new ReceiptService(audit as unknown as AuditService, pdf as unknown as PdfService)
	})

	describe("renderForOwner", () => {
		it("renders the owner's receipt from the database, with a QR code to the verify page", async () => {
			queueSelects([receiptRow], [{ serviceName: "Yellow fever vaccination", feeCentavos: 150000 }])

			const result = await service.renderForOwner(90, "client-1")

			expect(result).toEqual({
				fileName: "QSPS-R-261118-000090.pdf",
				pdf: Buffer.from("%PDF-1.3"),
			})
			expect(pdf.qrPng).toHaveBeenCalledWith(`http://localhost:3001/receipts/verify/${TOKEN}`)
			expect(drawReceipt).toHaveBeenCalledWith(
				{},
				expect.objectContaining({
					receiptNumber: "QSPS-R-261118-000090",
					referenceNumber: "QSPS-261117-AB12CD",
					clientName: "Alex Johnson",
					channelCode: "fake",
					items: [{ serviceName: "Yellow fever vaccination", feeCentavos: 150000 }],
					convenienceFeeCentavos: 0,
					totalCentavos: 150000,
					status: "valid",
				})
			)
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("answers 404 and audits a denial when another client asks", async () => {
			queueSelects([receiptRow])

			await expect(service.renderForOwner(90, "client-2")).rejects.toBeInstanceOf(NotFoundException)
			expect(pdf.render).not.toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "receipt.read",
					outcome: "denied",
					actorId: "client-2",
					targetId: "90",
					reason: "not_owner",
				})
			)
		})

		it("answers 404 when the payment has no receipt", async () => {
			queueSelects([])

			await expect(service.renderForOwner(91, "client-1")).rejects.toBeInstanceOf(NotFoundException)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", reason: "not_found" })
			)
		})

		it("shows a refunded payment's receipt as refunded", async () => {
			queueSelects([{ ...receiptRow, paymentStatus: "refunded" }], [])

			await service.renderForOwner(90, "client-1")

			expect(drawReceipt).toHaveBeenCalledWith({}, expect.objectContaining({ status: "refunded" }))
		})
	})

	describe("verify", () => {
		it("returns only the receipt number, amount, date and status", async () => {
			queueSelects([
				{
					receiptNumber: "QSPS-R-261118-000090",
					issuedAt: receiptRow.issuedAt,
					amountCentavos: 150000,
					paymentStatus: "succeeded",
				},
			])

			await expect(service.verify(TOKEN)).resolves.toEqual({
				receiptNumber: "QSPS-R-261118-000090",
				amountCentavos: 150000,
				issuedAt: receiptRow.issuedAt,
				status: "valid",
			})
		})

		// oRPC NOT_FOUND, not Nest's NotFoundException: inside an oRPC handler
		// any other error becomes a 500 and the page shows "could not be checked".
		it("answers 404 for an unknown token", async () => {
			queueSelects([])

			await expect(service.verify(TOKEN)).rejects.toMatchObject({ code: "NOT_FOUND" })
		})

		it("answers 404 for a malformed token without querying", async () => {
			await expect(service.verify("not-a-token")).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(db.select).not.toHaveBeenCalled()
		})
	})
})
