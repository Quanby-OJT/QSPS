import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { PolicyDocumentService } from "./policy-documents.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * ADM-9: written policies. RbacGuard checks settings.policies:manage on every
 * admin route (403 and a denied Audit Entry without it). Policies are
 * nationwide, so there is no Scope check. The published list is public.
 */
@Controller()
export class PolicyDocumentsController {
	constructor(private readonly policyDocumentService: PolicyDocumentService) {}

	@RequirePermissions("settings.policies:manage")
	@Implement(v1.policyDocuments.list)
	async list() {
		return implement(v1.policyDocuments.list).handler(() => this.policyDocumentService.list())
	}

	@StrictThrottle()
	@RequirePermissions("settings.policies:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.policyDocuments.create)
	async create(@Session() session?: UserSession) {
		return implement(v1.policyDocuments.create).handler(({ input }) =>
			this.policyDocumentService.create(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.policies:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.policyDocuments.update)
	async update(@Session() session?: UserSession) {
		return implement(v1.policyDocuments.update).handler(({ input }) =>
			this.policyDocumentService.update(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions("settings.policies:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.policyDocuments.withdraw)
	async withdraw(@Session() session?: UserSession) {
		return implement(v1.policyDocuments.withdraw).handler(({ input }) =>
			this.policyDocumentService.withdraw(input.documentKey, actorId(session))
		)
	}

	// Public on purpose: anyone may read the terms before signing up. The
	// answer is only what BOQ has published; the default throttle applies.
	@AllowAnonymous()
	@Implement(v1.policyDocuments.published)
	async published() {
		return implement(v1.policyDocuments.published).handler(() =>
			this.policyDocumentService.published()
		)
	}
}
