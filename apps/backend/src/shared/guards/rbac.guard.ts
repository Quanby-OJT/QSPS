import {
	ForbiddenException,
	Injectable,
	Logger,
	UnauthorizedException,
	type CanActivate,
	type ExecutionContext,
} from "@nestjs/common"
import { Reflector } from "@nestjs/core"

import { RbacService } from "@/common/rbac/rbac.service"
import { env } from "@/config/env.config"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import {
	resolveRequestSession,
	type RequestWithSession,
} from "@/shared/guards/resolve-request-session"

@Injectable()
export class RbacGuard implements CanActivate {
	// Instance logger (not injected) so the guard keeps a small constructor.
	// `app.useLogger(nestjs-pino Logger)` in bootstrap.ts routes these lines
	// through Pino, so denials land in the same structured sink as request logs.
	private readonly logger = new Logger(RbacGuard.name)

	constructor(
		private readonly reflector: Reflector,
		private readonly rbacService: RbacService
	) {}

	/**
	 * Record a permission denial so every rejected request is attributable
	 * (FND-2: "403 and an Audit Entry with outcome denied, the key, and the
	 * actor").
	 *
	 * The entry goes to the append-only `audit_log` through RbacService, and a
	 * log line is kept as well. Uses the handler identity rather than `req.url`:
	 * the URL can carry token-bearing query parameters.
	 *
	 * A failed audit write must not turn the 403 into a 500 or, worse, into an
	 * allowed request, so it is logged and the denial still stands.
	 */
	private async auditDenial(
		context: ExecutionContext,
		actorId: string,
		requiredPermissions: string[],
		missingPermissions: string[]
	): Promise<void> {
		const route = `${context.getClass().name}.${context.getHandler().name}`

		this.logger.warn({
			event: "rbac.permission_denied",
			actorId,
			action: route,
			requiredPermissions,
			missingPermissions,
		})

		try {
			await this.rbacService.recordPermissionDenial({
				actorId,
				route,
				requiredPermissions,
				missingPermissions,
			})
		} catch (error) {
			this.logger.error({
				event: "rbac.permission_denied.audit_failed",
				actorId,
				action: route,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		// Handler-level metadata overrides class-level (standard NestJS precedence):
		// a method's @RequirePermissions takes priority over the controller's.
		const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
			REQUIRED_PERMISSIONS_KEY,
			[context.getHandler(), context.getClass()]
		)

		// No decorator applied → guard is inert.
		if (!requiredPermissions || requiredPermissions.length === 0) {
			return true
		}

		// The user id comes only from the shared verified lookup. When the
		// throttler already resolved this request, that lookup is reused. The
		// helper sets request.session and request.user for later readers.
		const request = context.switchToHttp().getRequest<RequestWithSession>()
		const session = await resolveRequestSession(request)
		const userId = session?.user?.id

		// Fail closed: a protected route without a resolvable session is rejected.
		if (!userId) {
			throw new UnauthorizedException("Authentication required")
		}

		const allowed = await this.rbacService.hasAllPermissions(userId, requiredPermissions)
		if (allowed) {
			return true
		}

		// The audit entry always names the missing keys. Only the response
		// differs: verbose in non-production to aid debugging (HttpExceptionFilter
		// surfaces `missingPermissions` as details), generic in production.
		const missingPermissions = await this.rbacService.getMissingPermissions(
			userId,
			requiredPermissions
		)
		await this.auditDenial(context, userId, requiredPermissions, missingPermissions)

		if (env.NODE_ENV !== "production") {
			throw new ForbiddenException({ message: "Forbidden", missingPermissions })
		}

		throw new ForbiddenException("Forbidden")
	}
}
