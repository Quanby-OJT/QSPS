import { Controller, Inject, Optional, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { SchedulesService } from "./schedules.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

@Controller()
export class SchedulesController {
	constructor(
		private readonly schedulesService: SchedulesService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: every staff route works inside the caller's Scope. */
	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions("schedules.slots:manage")
	@Implement(v1.schedules.listSlots)
	async listSlots(@Session() session?: UserSession) {
		return implement(v1.schedules.listSlots).handler(async ({ input }) =>
			this.schedulesService.listSlots(input, await this.scopeOf(session))
		)
	}

	// No permission key on purpose: reading schedules needs only a signed-in
	// session (DOMAIN-MODEL.md section 2). The global session guard still applies.
	@Implement(v1.schedules.listAvailability)
	async listAvailability() {
		return implement(v1.schedules.listAvailability).handler(({ input }) =>
			this.schedulesService.listAvailability(input)
		)
	}

	@StrictThrottle()
	@RequirePermissions("schedules.slots:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.schedules.generateSlots)
	async generateSlots(@Session() session?: UserSession) {
		return implement(v1.schedules.generateSlots).handler(async ({ input }) =>
			this.schedulesService.generateSlots(
				input,
				actorId(session),
				new Date(),
				await this.scopeOf(session)
			)
		)
	}

	@StrictThrottle()
	@RequirePermissions("schedules.slots:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.schedules.updateSlotCapacity)
	async updateSlotCapacity(@Session() session?: UserSession) {
		return implement(v1.schedules.updateSlotCapacity).handler(async ({ input }) =>
			this.schedulesService.updateSlotCapacity(input, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("schedules.slots:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.schedules.setSlotDisabled)
	async setSlotDisabled(@Session() session?: UserSession) {
		return implement(v1.schedules.setSlotDisabled).handler(async ({ input }) =>
			this.schedulesService.setSlotDisabled(input, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("schedules.slots:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.schedules.deleteSlot)
	async deleteSlot(@Session() session?: UserSession) {
		return implement(v1.schedules.deleteSlot).handler(async ({ input }) =>
			this.schedulesService.deleteSlot(input.id, actorId(session), await this.scopeOf(session))
		)
	}
}
