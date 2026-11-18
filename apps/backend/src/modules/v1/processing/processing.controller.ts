import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ProcessingService } from "./processing.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * BOQ staff assessment (PRC-1). RbacGuard checks the permission key (403 and
 * a denied Audit Entry without it); ProcessingService checks the Location.
 */
@Controller()
export class ProcessingController {
	constructor(private readonly processingService: ProcessingService) {}

	@RequirePermissions("processing.queue:read")
	@Implement(v1.processing.queue)
	async queue(@Session() session?: UserSession) {
		return implement(v1.processing.queue).handler(({ input }) =>
			this.processingService.queue(input, actorId(session))
		)
	}

	@RequirePermissions("processing.queue:read")
	@Implement(v1.processing.item)
	async item(@Session() session?: UserSession) {
		return implement(v1.processing.item).handler(({ input }) =>
			this.processingService.item(input, actorId(session))
		)
	}

	// Scanning the same QR twice is harmless: items already checked in stay as they are.
	@StrictThrottle()
	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.checkIn)
	async checkIn(@Session() session?: UserSession) {
		return implement(v1.processing.checkIn).handler(({ input }) =>
			this.processingService.checkIn(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.open)
	async open(@Session() session?: UserSession) {
		return implement(v1.processing.open).handler(({ input }) =>
			this.processingService.open(input, actorId(session))
		)
	}

	// Idempotent: a double click with the same Idempotency-Key replays the
	// first result instead of adding a second Assessment.
	@StrictThrottle()
	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.assess)
	async assess(@Session() session?: UserSession) {
		return implement(v1.processing.assess).handler(({ input }) =>
			this.processingService.assess(input, actorId(session))
		)
	}
}
