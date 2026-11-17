import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

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
	constructor(private readonly servicesService: ServicesService) {}

	@Implement(v1.services.listCategories)
	async listCategories() {
		return implement(v1.services.listCategories).handler(() =>
			this.servicesService.listCategories()
		)
	}

	@RequirePermissions("settings.services:manage")
	@Implement(v1.services.list)
	async list() {
		return implement(v1.services.list).handler(() => this.servicesService.list())
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
		return implement(v1.services.create).handler(({ input }) =>
			this.servicesService.create(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.services:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.services.update)
	async update(@Session() session?: UserSession) {
		return implement(v1.services.update).handler(({ input }) =>
			this.servicesService.update(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.services:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.services.setActive)
	async setActive(@Session() session?: UserSession) {
		return implement(v1.services.setActive).handler(({ input }) =>
			this.servicesService.setActive(input, actorId(session))
		)
	}
}
