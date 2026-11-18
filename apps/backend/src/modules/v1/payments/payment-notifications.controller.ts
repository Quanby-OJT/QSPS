import {
	Controller,
	HttpCode,
	NotFoundException,
	Param,
	Post,
	Req,
	UnauthorizedException,
} from "@nestjs/common"
import { AllowAnonymous } from "@thallesp/nestjs-better-auth"
import type { Request } from "express"

import { PaymentService } from "./payments.service"

/** Express request with the body bytes kept by the parser (app.config.ts). */
type RequestWithRawBody = Request & { rawBody?: Buffer }

function lowerCaseHeaders(request: Request): Record<string, string | undefined> {
	const headers: Record<string, string | undefined> = {}
	for (const [name, value] of Object.entries(request.headers)) {
		headers[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : value
	}
	return headers
}

/**
 * Where payment gateways send their server-to-server notifications
 * (Flow C step 3): POST /api/v1/payments/notifications/{providerCode}.
 *
 * Public on purpose: gateways have no session. It needs no session or
 * permission key because nothing in the request is trusted until the
 * provider's signature over the raw body has been checked, and it has no
 * CSRF exposure because it reads no cookies. Not an oRPC route because the
 * signature is computed over the exact bytes sent, which oRPC does not keep.
 */
@Controller("v1/payments/notifications")
export class PaymentNotificationsController {
	constructor(private readonly paymentService: PaymentService) {}

	@AllowAnonymous()
	@Post(":providerCode")
	@HttpCode(200)
	async receive(@Param("providerCode") providerCode: string, @Req() request: RequestWithRawBody) {
		const rawBody = request.rawBody ? request.rawBody.toString("utf8") : ""

		const outcome = await this.paymentService.handleNotification(providerCode, {
			headers: lowerCaseHeaders(request),
			rawBody,
		})

		if (outcome === "unknown_provider") {
			throw new NotFoundException()
		}
		// Stored already. A non-2xx lets a real gateway retry if our secret was
		// misconfigured; a forger learns nothing new.
		if (outcome === "invalid_signature") {
			throw new UnauthorizedException("Invalid signature")
		}
		return { received: true }
	}
}
