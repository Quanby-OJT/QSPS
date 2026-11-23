import { Controller, Inject, Optional, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { FormsService } from "./forms.service"

const MANAGE = "forms.templates:manage"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * Form Template management (FRM-1). Every route needs
 * `forms.templates:manage`: without it RbacGuard answers 403 and audits the
 * denial. Every route works inside the caller's Scope by Service Category.
 */
@Controller()
export class FormsController {
	constructor(
		private readonly formsService: FormsService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	@RequirePermissions(MANAGE)
	@Implement(v1.forms.listServices)
	async listServices(@Session() session?: UserSession) {
		return implement(v1.forms.listServices).handler(async () =>
			this.formsService.listServices(await this.scopeOf(session))
		)
	}

	@RequirePermissions(MANAGE)
	@Implement(v1.forms.listVersions)
	async listVersions(@Session() session?: UserSession) {
		return implement(v1.forms.listVersions).handler(async ({ input }) =>
			this.formsService.listVersions(input.serviceId, actorId(session), await this.scopeOf(session))
		)
	}

	@RequirePermissions(MANAGE)
	@Implement(v1.forms.get)
	async get(@Session() session?: UserSession) {
		return implement(v1.forms.get).handler(async ({ input }) =>
			this.formsService.get(input.templateId, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions(MANAGE)
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.forms.createDraft)
	async createDraft(@Session() session?: UserSession) {
		return implement(v1.forms.createDraft).handler(async ({ input }) =>
			this.formsService.createDraft(input.serviceId, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions(MANAGE)
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.forms.saveFields)
	async saveFields(@Session() session?: UserSession) {
		return implement(v1.forms.saveFields).handler(async ({ input }) =>
			this.formsService.saveFields(
				input.templateId,
				input.fields,
				actorId(session),
				await this.scopeOf(session)
			)
		)
	}

	@StrictThrottle()
	@RequirePermissions(MANAGE)
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.forms.publish)
	async publish(@Session() session?: UserSession) {
		return implement(v1.forms.publish).handler(async ({ input }) =>
			this.formsService.publish(input.templateId, actorId(session), await this.scopeOf(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions(MANAGE)
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.forms.setActive)
	async setActive(@Session() session?: UserSession) {
		return implement(v1.forms.setActive).handler(async ({ input }) =>
			this.formsService.setActive(
				input.templateId,
				input.isActive,
				actorId(session),
				await this.scopeOf(session)
			)
		)
	}

	@StrictThrottle()
	@RequirePermissions(MANAGE)
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.forms.delete)
	async delete(@Session() session?: UserSession) {
		return implement(v1.forms.delete).handler(async ({ input }) =>
			this.formsService.delete(input.templateId, actorId(session), await this.scopeOf(session))
		)
	}
}
