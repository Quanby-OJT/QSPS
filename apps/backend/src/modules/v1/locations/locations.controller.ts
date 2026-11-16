import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

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
	constructor(private readonly locationsService: LocationsService) {}

	@RequirePermissions("settings.locations:manage")
	@Implement(v1.locations.list)
	async list() {
		return implement(v1.locations.list).handler(() => this.locationsService.list())
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
		return implement(v1.locations.create).handler(({ input }) =>
			this.locationsService.create(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.locations:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.locations.update)
	async update(@Session() session?: UserSession) {
		return implement(v1.locations.update).handler(({ input }) =>
			this.locationsService.update(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.locations:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.locations.setActive)
	async setActive(@Session() session?: UserSession) {
		return implement(v1.locations.setActive).handler(({ input }) =>
			this.locationsService.setActive(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.locations:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.locations.delete)
	async delete(@Session() session?: UserSession) {
		return implement(v1.locations.delete).handler(({ input }) =>
			this.locationsService.delete(input.code, actorId(session))
		)
	}
}
