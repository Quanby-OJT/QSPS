import { Controller, Inject, Optional, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { LocationsService } from "./locations.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

@Controller()
export class LocationsController {
	constructor(
		private readonly locationsService: LocationsService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: every staff route works inside the caller's Scope. */
	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions("settings.locations:manage")
	@Implement(v1.locations.list)
	async list(@Session() session?: UserSession) {
		return implement(v1.locations.list).handler(async () =>
			this.locationsService.list(await this.scopeOf(session))
		)
	}

	@Implement(v1.locations.listAvailable)
	async listAvailable() {
		return implement(v1.locations.listAvailable).handler(() =>
			this.locationsService.listAvailable()
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.locations:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.locations.create)
	async create(@Session() session?: UserSession) {
		return implement(v1.locations.create).handler(async ({ input }) =>
			this.locationsService.create(input, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.locations:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.locations.update)
	async update(@Session() session?: UserSession) {
		return implement(v1.locations.update).handler(async ({ input }) =>
			this.locationsService.update(input, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.locations:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.locations.setActive)
	async setActive(@Session() session?: UserSession) {
		return implement(v1.locations.setActive).handler(async ({ input }) =>
			this.locationsService.setActive(input, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.locations:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.locations.delete)
	async delete(@Session() session?: UserSession) {
		return implement(v1.locations.delete).handler(async ({ input }) =>
			this.locationsService.delete(input.code, actorId(session), await this.scopeOf(session))
		)
	}
}
