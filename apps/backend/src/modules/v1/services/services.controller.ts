import { Controller, Inject, Optional, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ServicesService } from "./services.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

@Controller()
export class ServicesController {
	constructor(
		private readonly servicesService: ServicesService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: every staff route works inside the caller's Scope. */
	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@Implement(v1.services.listCategories)
	async listCategories() {
		return implement(v1.services.listCategories).handler(() =>
			this.servicesService.listCategories()
		)
	}

	@RequirePermissions("settings.services:manage")
	@Implement(v1.services.list)
	async list(@Session() session?: UserSession) {
		return implement(v1.services.list).handler(async () =>
			this.servicesService.list(await this.scopeOf(session))
		)
	}

	@Implement(v1.services.listAvailable)
	async listAvailable() {
		return implement(v1.services.listAvailable).handler(() => this.servicesService.listAvailable())
	}

	@StrictThrottle()
	@RequirePermissions("settings.services:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.services.create)
	async create(@Session() session?: UserSession) {
		return implement(v1.services.create).handler(async ({ input }) =>
			this.servicesService.create(input, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.services:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.services.update)
	async update(@Session() session?: UserSession) {
		return implement(v1.services.update).handler(async ({ input }) =>
			this.servicesService.update(input, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.services:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.services.setActive)
	async setActive(@Session() session?: UserSession) {
		return implement(v1.services.setActive).handler(async ({ input }) =>
			this.servicesService.setActive(input, actorId(session), await this.scopeOf(session))
		)
	}
}
