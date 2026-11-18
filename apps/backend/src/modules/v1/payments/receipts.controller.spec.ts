import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { ReceiptsController } from "./receipts.controller"
import type { ReceiptService } from "./receipts.service"

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))
jest.mock("./receipts.service", () => ({
	ReceiptService: jest.fn(),
}))

describe("ReceiptsController", () => {
	it("requires bookings.own:read to download a receipt", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ReceiptsController.prototype.download)
		).toEqual(["bookings.own:read"])
	})

	it("sends the PDF inline, uncached, under the receipt number", async () => {
		const renderForOwner = jest
			.fn()
			.mockResolvedValue({ fileName: "QSPS-R-261118-000001.pdf", pdf: Buffer.from("%PDF-1.3") })
		const controller = new ReceiptsController({ renderForOwner } as unknown as ReceiptService)
		const response = { setHeader: jest.fn(), end: jest.fn() }

		await controller.download(1, response as never, { user: { id: "client-1" } } as never)

		expect(renderForOwner).toHaveBeenCalledWith(1, "client-1")
		expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf")
		expect(response.setHeader).toHaveBeenCalledWith(
			"Content-Disposition",
			'inline; filename="QSPS-R-261118-000001.pdf"'
		)
		expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store")
		expect(response.end).toHaveBeenCalledWith(Buffer.from("%PDF-1.3"))
	})
})
