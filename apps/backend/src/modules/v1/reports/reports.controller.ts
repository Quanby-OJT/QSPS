import { Controller } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { ScopeService } from "@/common/scope/scope.service"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { ReportsService } from "./reports.service"

@Controller()
export class ReportsController {
	constructor(
		private readonly reportsService: ReportsService,
		private readonly scopeService: ScopeService
	) {}

	@RequirePermissions("reports.dashboard:read")
	@Implement(v1.reports.dashboard)
	async dashboard(@Session() session?: UserSession) {
		return implement(v1.reports.dashboard).handler(async ({ input }) => {
			const scope = await this.scopeService.resolve(session?.user?.id ?? null)
			return this.reportsService.dashboard(input.period, input.date, scope)
		})
	}
}