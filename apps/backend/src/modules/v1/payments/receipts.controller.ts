import { Controller, Get, Param, ParseIntPipe, Res } from "@nestjs/common"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { ReceiptService } from "./receipts.service"

/**
 * The e-Receipt PDF: GET /api/v1/payments/{paymentId}/receipt.
 *
 * A plain route rather than oRPC because it answers with PDF bytes, not
 * JSON. Opens in the browser's PDF viewer, from which it can be downloaded
 * or printed. The public verification lookup is the oRPC route
 * `payments.verifyReceipt`.
 */
@Controller("v1/payments")
export class ReceiptsController {
	constructor(private readonly receiptService: ReceiptService) {}

	@RequirePermissions("bookings.own:read")
	@Get(":paymentId/receipt")
	async download(
		@Param("paymentId", ParseIntPipe) paymentId: number,
		@Res() response: Response,
		@Session() session?: UserSession
	): Promise<void> {
		const { fileName, pdf } = await this.receiptService.renderForOwner(
			paymentId,
			session?.user?.id ?? null
		)
		// A receipt names the client: never cache it in shared caches.
		response.setHeader("Cache-Control", "private, no-store")
		response.setHeader("Content-Type", "application/pdf")
		response.setHeader("Content-Disposition", `inline; filename="${fileName}"`)
		response.setHeader("Content-Length", String(pdf.length))
		response.end(pdf)
	}
}
