import {
	Controller,
	Get,
	HttpException,
	Inject,
	Optional,
	Param,
	ParseIntPipe,
	Query,
	Res,
	UseInterceptors,
} from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { CashierService } from "./cashier.service"
import type { ReceiptLayout } from "./receipts.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * The cashier screen (PAY-4). Every route needs `payments.onsite:collect`:
 * RbacGuard answers 403 and audits the denial without it. CashierService
 * applies Scope (404 and an audited denial outside it).
 *
 * There are no routes here that edit a client or a schedule (Annex A).
 */
@Controller()
export class CashierController {
	constructor(
		private readonly cashierService: CashierService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions("payments.onsite:collect")
	@Implement(v1.cashier.search)
	async search(@Session() session?: UserSession) {
		return implement(v1.cashier.search).handler(async ({ input }) =>
			this.cashierService.search(input.q, actorId(session), await this.scopeOf(session))
		)
	}

	@RequirePermissions("payments.onsite:collect")
	@Implement(v1.cashier.get)
	async get(@Session() session?: UserSession) {
		return implement(v1.cashier.get).handler(async ({ input }) =>
			this.cashierService.get(input.bookingId, actorId(session), await this.scopeOf(session))
		)
	}

	// Normal throttle, not the strict one: several cashier terminals in one office
	// share an IP. Idempotent: a double click or a retried request with the same
	// Idempotency-Key replays the first answer instead of creating a second Payment.
	@RequirePermissions("payments.onsite:collect")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.cashier.collect)
	async collect(@Session() session?: UserSession) {
		return implement(v1.cashier.collect).handler(async ({ input }) =>
			this.cashierService.collect(input, actorId(session), await this.scopeOf(session))
		)
	}

	/**
	 * Print or reprint a receipt: GET /api/v1/cashier/payments/{paymentId}/receipt?layout=a4|passbook.
	 * A plain route because it answers with PDF bytes.
	 */
	@RequirePermissions("payments.onsite:collect")
	@Get("v1/cashier/payments/:paymentId/receipt")
	async receipt(
		@Param("paymentId", ParseIntPipe) paymentId: number,
		@Query("layout") layoutParam: string | undefined,
		@Res() response: Response,
		@Session() session?: UserSession
	): Promise<void> {
		const layout: ReceiptLayout = layoutParam === "passbook" ? "passbook" : "a4"
		let receipt: Awaited<ReturnType<CashierService["receipt"]>>
		try {
			receipt = await this.cashierService.receipt(
				paymentId,
				layout,
				actorId(session),
				await this.scopeOf(session)
			)
		} catch (error) {
			// The service speaks oRPC errors; this route is plain Nest.
			if (error instanceof ORPCError) throw new HttpException(error.message, error.status)
			throw error
		}
		// A receipt names the client: never cache it in shared caches.
		response.setHeader("Cache-Control", "private, no-store")
		response.setHeader("Content-Type", "application/pdf")
		response.setHeader("Content-Disposition", `inline; filename="${receipt.fileName}"`)
		response.setHeader("Content-Length", String(receipt.pdf.length))
		response.end(receipt.pdf)
	}
}
