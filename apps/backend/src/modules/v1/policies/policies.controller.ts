import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { PolicyService } from "@/common/policy/policy.service"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

/** ADM-6: the policy screen. Policies are nationwide, so there is no Scope check. */
@Controller()
export class PoliciesController {
	constructor(private readonly policyService: PolicyService) {}

	@RequirePermissions("settings.policies:manage")
	@Implement(v1.policies.list)
	async list() {
		return implement(v1.policies.list).handler(() => this.policyService.list())
	}

	@StrictThrottle()
	@RequirePermissions("settings.policies:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.policies.update)
	async update(@Session() session?: UserSession) {
		return implement(v1.policies.update).handler(({ input }) =>
			this.policyService.set(input.key, input.value, session?.user?.id ?? null)
		)
	}
}
