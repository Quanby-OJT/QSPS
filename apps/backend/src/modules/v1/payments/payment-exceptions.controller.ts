import { Controller, Inject, Optional } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"

import { PaymentExceptionsService } from "./payment-exceptions.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * Payment exceptions (PAY-6). Reading needs `payments.transactions:read`;
 * resolving needs `bookings.all:override`. RbacGuard answers 403 and audits
 * the denial without the key; PaymentExceptionsService applies Scope.
 */
@Controller()
export class PaymentExceptionsController {
	constructor(
		private readonly exceptionsService: PaymentExceptionsService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions("payments.transactions:read")
	@Implement(v1.paymentExceptions.list)
	async list(@Session() session?: UserSession) {
		return implement(v1.paymentExceptions.list).handler(async () =>
			this.exceptionsService.list(await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("bookings.all:override")
	@Implement(v1.paymentExceptions.resolve)
	async resolve(@Session() session?: UserSession) {
		return implement(v1.paymentExceptions.resolve).handler(async ({ input }) =>
			this.exceptionsService.resolve(input, actorId(session), await this.scopeOf(session))
		)
	}
}
