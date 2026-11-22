import { db } from "@/common/database/database.client"
import type { PdfService } from "@/common/pdf/pdf.service"
import type { ReceiptService } from "@/modules/v1/payments/receipts.service"

import type { TemplateEmailSender } from "./email.sender"
import { NotificationWorker } from "./notification.worker"

jest.mock("@/common/database/database.client", () => ({ db: { transaction: jest.fn() } }))
jest.mock("@/modules/v1/payments/receipts.service", () => ({ ReceiptService: jest.fn() }))
jest.mock("@/common/pdf/pdf.service", () => ({ PdfService: jest.fn() }))
jest.mock("./email.sender", () => ({ TemplateEmailSender: jest.fn() }))

describe("NotificationWorker", () => {
	const now = new Date("2026-11-23T00:00:00Z")
	const send = jest.fn()
	const renderForOwner = jest.fn()
	const qrPng = jest.fn()
	const worker = new NotificationWorker(
		{ send } as unknown as TemplateEmailSender,
		{ renderForOwner } as unknown as ReceiptService,
		{ qrPng } as unknown as PdfService
	)
	const row = {
		id: 1,
		userId: "client-1",
		template: "payment_received",
		attempts: 0,
		payload: { paymentId: 20, referenceNumber: "QSPS-261123-ABC123" },
	}

	function transaction(rows: unknown[]) {
		const lock = jest.fn().mockResolvedValue(rows)
		const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) })
		const select = jest
			.fn()
			.mockReturnValueOnce({
				from: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ for: lock }) }) }) }),
			})
			.mockReturnValueOnce({
				from: () => ({ where: () => Promise.resolve([{ email: "client@example.test" }]) }),
			})
		const tx = { select, update: () => ({ set }) }
		;(db.transaction as jest.Mock).mockImplementation(async callback => callback(tx))
		return { lock, set }
	}

	beforeEach(() => {
		jest.resetAllMocks()
		send.mockResolvedValue(undefined)
		renderForOwner.mockResolvedValue({ fileName: "receipt.pdf", pdf: Buffer.from("PDF") })
		qrPng.mockResolvedValue(Buffer.from("QR"))
	})

	it("locks a due row and sends the receipt and booking QR to its owner", async () => {
		const { lock, set } = transaction([row])
		await expect(worker.processOne(now)).resolves.toBe(true)
		expect(lock).toHaveBeenCalledWith("update", { skipLocked: true })
		expect(renderForOwner).toHaveBeenCalledWith(20, "client-1")
		expect(qrPng).toHaveBeenCalledWith("QSPS-261123-ABC123")
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: "client@example.test",
				attachments: [
					{ filename: "receipt.pdf", content: Buffer.from("PDF"), contentType: "application/pdf" },
					{ filename: "booking-qr.png", content: Buffer.from("QR"), contentType: "image/png" },
				],
			})
		)
		expect(set).toHaveBeenCalledWith({ status: "sent", attempts: 1 })
	})

	it("retries failure with increasing delay", async () => {
		const { set } = transaction([{ ...row, attempts: 2 }])
		send.mockRejectedValue(new Error("SMTP unavailable"))
		await expect(worker.processOne(now)).resolves.toBe(true)
		expect(set).toHaveBeenCalledWith({
			status: "queued",
			attempts: 3,
			nextAttemptAt: new Date(now.getTime() + 240_000),
		})
	})

	it("marks the fifth failed delivery terminal", async () => {
		const { set } = transaction([{ ...row, attempts: 4 }])
		send.mockRejectedValue(new Error("SMTP unavailable"))
		await expect(worker.processOne(now)).resolves.toBe(true)
		expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", attempts: 5 }))
	})

	it("does not send email when no due row is available", async () => {
		const { set } = transaction([])
		await expect(worker.processOne(now)).resolves.toBe(false)
		expect(send).not.toHaveBeenCalled()
		expect(set).not.toHaveBeenCalled()
	})
})
