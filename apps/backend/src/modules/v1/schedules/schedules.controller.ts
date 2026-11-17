import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

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
	constructor(private readonly schedulesService: SchedulesService) {}

	@RequirePermissions("schedules.slots:manage")
	@Implement(v1.schedules.listSlots)
	async listSlots() {
		return implement(v1.schedules.listSlots).handler(({ input }) =>
			this.schedulesService.listSlots(input)
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
		return implement(v1.schedules.generateSlots).handler(({ input }) =>
			this.schedulesService.generateSlots(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("schedules.slots:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.schedules.updateSlotCapacity)
	async updateSlotCapacity(@Session() session?: UserSession) {
		return implement(v1.schedules.updateSlotCapacity).handler(({ input }) =>
			this.schedulesService.updateSlotCapacity(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("schedules.slots:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.schedules.setSlotDisabled)
	async setSlotDisabled(@Session() session?: UserSession) {
		return implement(v1.schedules.setSlotDisabled).handler(({ input }) =>
			this.schedulesService.setSlotDisabled(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("schedules.slots:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.schedules.deleteSlot)
	async deleteSlot(@Session() session?: UserSession) {
		return implement(v1.schedules.deleteSlot).handler(({ input }) =>
			this.schedulesService.deleteSlot(input.id, actorId(session))
		)
	}
}
