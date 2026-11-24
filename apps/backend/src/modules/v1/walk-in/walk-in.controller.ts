import { Controller, Inject, Optional, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { FormSubmissionService } from "../forms/form-submissions.service"
import { FormUploadService } from "../forms/form-uploads.service"
import { PolicyDocumentService } from "../policies/policy-documents.service"
import { WalkInService } from "./walk-in.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * PRC-2: walk-in clients. Every route needs `bookings.walk-in:create`;
 * RbacGuard answers 403 and audits the denial without it. WalkInService
 * checks the officer's Location and Scope (404 and a denied audit outside it).
 */
@Controller()
export class WalkInController {
	constructor(
		private readonly walkInService: WalkInService,
		private readonly policyDocumentService: PolicyDocumentService,
		private readonly formSubmissionService: FormSubmissionService,
		private readonly formUploadService: FormUploadService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: no resolver wired in means no Scope, so a wiring mistake fails closed. */
	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions("bookings.walk-in:create")
	@Implement(v1.walkIn.lookupClients)
	async lookupClients() {
		return implement(v1.walkIn.lookupClients).handler(({ input }) =>
			this.walkInService.lookup(input.query)
		)
	}

	// Strict throttle: each call creates an account and sends an email.
	@StrictThrottle()
	@RequirePermissions("bookings.walk-in:create")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.walkIn.createClient)
	async createClient(@Session() session?: UserSession) {
		return implement(v1.walkIn.createClient).handler(({ input }) =>
			this.walkInService.createClient(input, actorId(session))
		)
	}

	@RequirePermissions("bookings.walk-in:create")
	@Implement(v1.walkIn.slots)
	async slots(@Session() session?: UserSession) {
		return implement(v1.walkIn.slots).handler(async ({ input }) =>
			this.walkInService.slots(input.serviceId, actorId(session), await this.scopeOf(session))
		)
	}

	@RequirePermissions("bookings.walk-in:create")
	@Implement(v1.walkIn.policies)
	async policies() {
		return implement(v1.walkIn.policies).handler(({ input }) =>
			this.policyDocumentService.forService(input.serviceId)
		)
	}

	@RequirePermissions("bookings.walk-in:create")
	@Implement(v1.walkIn.form)
	async form() {
		return implement(v1.walkIn.form).handler(({ input }) =>
			this.formSubmissionService.forService(input.serviceId)
		)
	}

	// Stored under the officer's own folder; the booking confirms it (FRM-2b).
	@StrictThrottle()
	@RequirePermissions("bookings.walk-in:create")
	@Implement(v1.walkIn.uploadFormFile)
	async uploadFormFile(@Session() session?: UserSession) {
		return implement(v1.walkIn.uploadFormFile).handler(({ input }) =>
			this.formUploadService.upload(input.file, actorId(session))
		)
	}

	// Idempotent: a double click with the same Idempotency-Key replays the
	// first booking instead of making a second one.
	@RequirePermissions("bookings.walk-in:create")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.walkIn.createBooking)
	async createBooking(@Session() session?: UserSession) {
		return implement(v1.walkIn.createBooking).handler(async ({ input }) =>
			this.walkInService.createBooking(input, actorId(session), await this.scopeOf(session))
		)
	}
}
