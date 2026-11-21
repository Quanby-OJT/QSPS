import { Controller, Inject, Optional, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { RbacService } from "@/common/rbac/rbac.service"
import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { RbacAdminService } from "./rbac-admin.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

@Controller()
export class RbacController {
	constructor(
		private readonly rbacAdminService: RbacAdminService,
		private readonly rbacService: RbacService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: user routes work inside the caller's Scope. */
	private async scopeOf(session?: UserSession) {
		return this.scopeResolver ? this.scopeResolver.resolve(actorId(session)) : NO_SCOPE
	}

	// ---------------------------------------------------------------- roles
	@RequirePermissions("users.roles:manage")
	@Implement(v1.rbac.roles.list)
	async listRoles() {
		return implement(v1.rbac.roles.list).handler(async () => {
			return this.rbacAdminService.listRoles()
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.roles:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.roles.create)
	async createRole(@Session() session?: UserSession) {
		return implement(v1.rbac.roles.create).handler(async ({ input }) => {
			return this.rbacAdminService.createRole(input, actorId(session))
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.roles:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.roles.update)
	async updateRole(@Session() session?: UserSession) {
		return implement(v1.rbac.roles.update).handler(async ({ input }) => {
			return this.rbacAdminService.updateRole(input, actorId(session))
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.roles:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.roles.setPermissions)
	async setRolePermissions(@Session() session?: UserSession) {
		return implement(v1.rbac.roles.setPermissions).handler(async ({ input }) => {
			return this.rbacAdminService.setRolePermissions(input, actorId(session))
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.roles:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.roles.delete)
	async deleteRole(@Session() session?: UserSession) {
		return implement(v1.rbac.roles.delete).handler(async ({ input }) => {
			return this.rbacAdminService.deleteRole(input.id, actorId(session))
		})
	}

	// ---------------------------------------------------------- permissions
	@RequirePermissions("users.roles:manage")
	@Implement(v1.rbac.permissions.list)
	async listPermissions() {
		return implement(v1.rbac.permissions.list).handler(async () => {
			return this.rbacAdminService.listPermissions()
		})
	}

	// ---------------------------------------------------------------- users
	@RequirePermissions("users.accounts:read")
	@Implement(v1.rbac.users.list)
	async listUsers(@Session() session?: UserSession) {
		return implement(v1.rbac.users.list).handler(async ({ input }) => {
			const userId = session?.user?.id
			const includeDirectory = userId
				? await this.rbacService.hasPermission(userId, "users.accounts:manage")
				: false

			return this.rbacAdminService.listUsers(input, includeDirectory, await this.scopeOf(session))
		})
	}

	@RequirePermissions("users.accounts:read")
	@Implement(v1.rbac.users.export)
	async exportUsers(@Session() session?: UserSession) {
		return implement(v1.rbac.users.export).handler(async ({ input }) => {
			const userId = session?.user?.id
			const includeDirectory = userId
				? await this.rbacService.hasPermission(userId, "users.accounts:manage")
				: false

			return this.rbacAdminService.exportUsers(
				input,
				includeDirectory,
				actorId(session),
				await this.scopeOf(session)
			)
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.accounts:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.users.create)
	async createUser(@Session() session?: UserSession) {
		return implement(v1.rbac.users.create).handler(async ({ input }) => {
			return this.rbacAdminService.createUser(input, actorId(session), await this.scopeOf(session))
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.accounts:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.users.update)
	async updateUser(@Session() session?: UserSession) {
		return implement(v1.rbac.users.update).handler(async ({ input }) => {
			return this.rbacAdminService.updateUser(input, actorId(session), await this.scopeOf(session))
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.accounts:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.users.setStatus)
	async setUserStatus(@Session() session?: UserSession) {
		return implement(v1.rbac.users.setStatus).handler(async ({ input }) => {
			return this.rbacAdminService.setUserStatus(
				input,
				actorId(session),
				await this.scopeOf(session)
			)
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.accounts:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.users.delete)
	async deleteUser(@Session() session?: UserSession) {
		return implement(v1.rbac.users.delete).handler(async ({ input }) => {
			return this.rbacAdminService.deleteUser(
				input.userId,
				actorId(session),
				await this.scopeOf(session)
			)
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.roles:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.users.assignRole)
	async assignRole(@Session() session?: UserSession) {
		return implement(v1.rbac.users.assignRole).handler(async ({ input }) => {
			return this.rbacAdminService.assignUserRole(input, actorId(session))
		})
	}

	// ADM-2: RbacGuard answers 403 and audits the denial without users.scopes:manage.
	@RequirePermissions("users.scopes:manage")
	@Implement(v1.rbac.users.getScopes)
	async getUserScopes(@Session() session?: UserSession) {
		return implement(v1.rbac.users.getScopes).handler(async ({ input }) => {
			return this.rbacAdminService.getUserScopes(
				input.userId,
				actorId(session),
				await this.scopeOf(session)
			)
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.scopes:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.users.setScopes)
	async setUserScopes(@Session() session?: UserSession) {
		return implement(v1.rbac.users.setScopes).handler(async ({ input }) => {
			return this.rbacAdminService.setUserScopes(
				input,
				actorId(session),
				await this.scopeOf(session)
			)
		})
	}

	@StrictThrottle()
	@RequirePermissions("users.roles:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.rbac.users.removeRole)
	async removeRole(@Session() session?: UserSession) {
		return implement(v1.rbac.users.removeRole).handler(async ({ input }) => {
			return this.rbacAdminService.removeUserRole(input, actorId(session))
		})
	}

	// ------------------------------------------------------------ audit log
	// ADM-3: without audit.logs:read, RbacGuard answers 403 and audits the denial.
	// There is no edit or delete route for audit entries, and there never will be.
	@RequirePermissions("audit.logs:read")
	@Implement(v1.rbac.audit.list)
	async listAuditLog() {
		return implement(v1.rbac.audit.list).handler(async ({ input }) => {
			return this.rbacAdminService.listAuditLog(input)
		})
	}

	// Must stay above getAuditEntry: Nest matches routes in the order they are
	// declared, so "/audit-log/{id}" would otherwise take "/audit-log/export".
	@StrictThrottle()
	@RequirePermissions("audit.logs:export")
	@Implement(v1.rbac.audit.export)
	async exportAuditLog(@Session() session?: UserSession) {
		return implement(v1.rbac.audit.export).handler(async ({ input }) => {
			return this.rbacAdminService.exportAuditLog(input, actorId(session))
		})
	}

	@RequirePermissions("audit.logs:read")
	@Implement(v1.rbac.audit.get)
	async getAuditEntry() {
		return implement(v1.rbac.audit.get).handler(async ({ input }) => {
			return this.rbacAdminService.getAuditEntry(input.id)
		})
	}
}