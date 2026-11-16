import { Controller, UnauthorizedException } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement, ORPCError } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { RbacService } from "@/common/rbac/rbac.service"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { MeProfileService } from "./me-profile.service"

/** The signed-in user id, or an oRPC 401 (Nest exceptions become 500s inside oRPC). */
function requireUserId(session?: UserSession): string {
	const userId = session?.user?.id
	if (!userId) throw new ORPCError("UNAUTHORIZED", { message: "Authentication required" })
	return userId
}

@Controller()
export class MeController {
	constructor(
		private readonly rbacService: RbacService,
		private readonly meProfileService: MeProfileService
	) {}

	@Implement(v1.me.permissions)
	async getPermissions(@Session() session?: UserSession) {
		return implement(v1.me.permissions).handler(async () => {
			const userId = session?.user?.id
			if (!userId) {
				throw new UnauthorizedException("Authentication required")
			}

			return this.rbacService.getUserAccess(userId)
		})
	}

	// Reading your own profile needs only a session, so the web can always find
	// out whether to show the complete-profile screen.
	@Implement(v1.me.profile)
	async getProfile(@Session() session?: UserSession) {
		return implement(v1.me.profile).handler(async () => {
			return this.meProfileService.getProfile(requireUserId(session))
		})
	}

	@RequirePermissions("account.profile:manage")
	@Implement(v1.me.updateProfile)
	async updateProfile(@Session() session?: UserSession) {
		return implement(v1.me.updateProfile).handler(async ({ input }) => {
			return this.meProfileService.updateProfile(requireUserId(session), input)
		})
	}
}
