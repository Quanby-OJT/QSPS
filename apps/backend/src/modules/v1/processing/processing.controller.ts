import { Controller, Inject, Optional, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { ProcessingService } from "./processing.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * BOQ staff assessment (PRC-1) and head approval (PRC-3). RbacGuard checks
 * the permission key (403 and a denied Audit Entry without it);
 * ProcessingService checks Scope and the Location.
 *
 * These routes use the normal throttle, not the strict one: staff make three
 * calls per client (check in, open, assess), and every route already needs a
 * staff session and a processing permission.
 */
@Controller()
export class ProcessingController {
	constructor(
		private readonly processingService: ProcessingService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: the queue and item routes work inside the caller's Scope. */
	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions("processing.queue:read")
	@Implement(v1.processing.queue)
	async queue(@Session() session?: UserSession) {
		return implement(v1.processing.queue).handler(async ({ input }) =>
			this.processingService.queue(input, actorId(session), new Date(), await this.scopeOf(session))
		)
	}

	@RequirePermissions("processing.queue:read")
	@Implement(v1.processing.item)
	async item(@Session() session?: UserSession) {
		return implement(v1.processing.item).handler(async ({ input }) =>
			this.processingService.item(input, actorId(session), await this.scopeOf(session))
		)
	}

	// Scanning the same QR twice is harmless: items already checked in stay as they are.
	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.checkIn)
	async checkIn(@Session() session?: UserSession) {
		return implement(v1.processing.checkIn).handler(({ input }) =>
			this.processingService.checkIn(input, actorId(session))
		)
	}

	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.open)
	async open(@Session() session?: UserSession) {
		return implement(v1.processing.open).handler(async ({ input }) =>
			this.processingService.open(input, actorId(session), await this.scopeOf(session))
		)
	}

	// Idempotent: a double click with the same Idempotency-Key replays the
	// first result instead of adding a second Assessment.
	@RequirePermissions("processing.assessments:perform")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.assess)
	async assess(@Session() session?: UserSession) {
		return implement(v1.processing.assess).handler(async ({ input }) =>
			this.processingService.assess(input, actorId(session), await this.scopeOf(session))
		)
	}

	// PRC-3: head approval. Only holders of processing.assessments:approve, and
	// only for items inside their Scope.
	@RequirePermissions("processing.assessments:approve")
	@Implement(v1.processing.approvals)
	async approvals(@Session() session?: UserSession) {
		return implement(v1.processing.approvals).handler(async ({ input }) =>
			this.processingService.approvals(input, actorId(session), await this.scopeOf(session))
		)
	}

	@RequirePermissions("processing.assessments:approve")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.decide)
	async decide(@Session() session?: UserSession) {
		return implement(v1.processing.decide).handler(async ({ input }) =>
			this.processingService.decide(input, actorId(session), await this.scopeOf(session))
		)
	}

	@RequirePermissions("processing.assessments:approve")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.processing.override)
	async override(@Session() session?: UserSession) {
		return implement(v1.processing.override).handler(async ({ input }) =>
			this.processingService.override(input, actorId(session), await this.scopeOf(session))
		)
	}
}
