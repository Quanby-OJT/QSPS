import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { AllowAnonymous } from "@thallesp/nestjs-better-auth"

import { PolicyService } from "@/common/policy/policy.service"
import { v1 } from "@/config/api-versions.config"

/**
 * ADM-8: the help desk channels for the Help pages. Public on purpose: a
 * visitor who cannot sign in still needs to reach the help desk. The answer
 * holds only what BOQ publishes, and the default throttle applies. The values
 * are changed through `PUT /v1/policies`, which needs settings.policies:manage.
 */
@Controller()
export class SupportController {
	constructor(private readonly policyService: PolicyService) {}

	@AllowAnonymous()
	@Implement(v1.support.contacts)
	async contacts() {
		return implement(v1.support.contacts).handler(() => this.policyService.supportContacts())
	}
}
