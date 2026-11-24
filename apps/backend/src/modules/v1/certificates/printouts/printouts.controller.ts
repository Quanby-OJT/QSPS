import {
	Controller,
	Get,
	HttpCode,
	Inject,
	Optional,
	Param,
	ParseIntPipe,
	Post,
	Res,
} from "@nestjs/common"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { PrintoutService, type OwnerApplicationForm } from "./printouts.service"
import { sendPdf } from "./send-pdf"

/**
 * Printouts that are not issued Documents (CRT-4):
 * - GET  /api/v1/certificates/printouts/bookings/{id}/application-forms,
 *   the client's own Booking: which of its items have an application form.
 * - GET  /api/v1/certificates/printouts/booking-items/{id}/application-form,
 *   the client downloads their own application form.
 * - POST /api/v1/certificates/printouts/booking-items/{id}/application-form/print,
 *   staff print it.
 * - POST /api/v1/certificates/printouts/bookings/{id}/request-for-payment/print,
 *   staff print the Request for Payment for the cashier.
 *
 * Plain routes rather than oRPC because they answer with PDF bytes. A missing
 * permission gets 403 and is audited by the RBAC guard.
 */
@Controller("v1/certificates/printouts")
export class PrintoutsController {
	constructor(
		private readonly printoutService: PrintoutService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	@RequirePermissions("bookings.own:read")
	@Get("bookings/:bookingId/application-forms")
	async listApplicationForms(
		@Param("bookingId", ParseIntPipe) bookingId: number,
		@Session() session?: UserSession
	): Promise<{ items: OwnerApplicationForm[] }> {
		const items = await this.printoutService.applicationFormsForOwner(
			bookingId,
			session?.user?.id ?? null
		)
		return { items }
	}

	@RequirePermissions("bookings.own:read")
	@Get("booking-items/:bookingItemId/application-form")
	async downloadApplicationForm(
		@Param("bookingItemId", ParseIntPipe) bookingItemId: number,
		@Res() response: Response,
		@Session() session?: UserSession
	): Promise<void> {
		const { fileName, pdf } = await this.printoutService.applicationFormForOwner(
			bookingItemId,
			session?.user?.id ?? null
		)
		sendPdf(response, fileName, pdf)
	}

	@RequirePermissions("certificates.documents:print")
	@Post("booking-items/:bookingItemId/application-form/print")
	@HttpCode(200)
	async printApplicationForm(
		@Param("bookingItemId", ParseIntPipe) bookingItemId: number,
		@Res() response: Response,
		@Session() session?: UserSession
	): Promise<void> {
		const userId = session?.user?.id ?? null
		// ADM-2: no resolver wired in means no Scope, so a wiring mistake fails closed.
		const scope = this.scopeResolver ? await this.scopeResolver.resolve(userId) : NO_SCOPE
		const { fileName, pdf } = await this.printoutService.applicationFormForStaff(
			bookingItemId,
			userId,
			scope
		)
		sendPdf(response, fileName, pdf)
	}

	@RequirePermissions("certificates.documents:print")
	@Post("bookings/:bookingId/request-for-payment/print")
	@HttpCode(200)
	async printRequestForPayment(
		@Param("bookingId", ParseIntPipe) bookingId: number,
		@Res() response: Response,
		@Session() session?: UserSession
	): Promise<void> {
		const userId = session?.user?.id ?? null
		const scope = this.scopeResolver ? await this.scopeResolver.resolve(userId) : NO_SCOPE
		const { fileName, pdf } = await this.printoutService.requestForPaymentForStaff(
			bookingId,
			userId,
			scope
		)
		sendPdf(response, fileName, pdf)
	}
}
