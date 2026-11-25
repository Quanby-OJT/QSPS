import { Controller, Inject, Optional, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import type { ResolvedScope } from "@/common/scope/scope-match"
import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { DocumentService } from "./documents.service"
import { SeminarSessionService } from "./seminars/seminar-sessions.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * Documents (CRT-1, CRT-2, CRT-8) and seminar sessions (CRT-6). RbacGuard
 * checks the permission key (403 and a denied Audit Entry without it);
 * DocumentService and SeminarSessionService check the Location, the Scope or
 * the owner. The two verify routes are public.
 */
@Controller()
export class CertificatesController {
	constructor(
		private readonly documentService: DocumentService,
		private readonly seminarSessionService: SeminarSessionService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	/** ADM-2: no resolver wired in means no Scope, so a wiring mistake fails closed. */
	private async scopeOf(userId: string | null): Promise<ResolvedScope> {
		return this.scopeResolver ? this.scopeResolver.resolve(userId) : NO_SCOPE
	}

	// Idempotent: a double click replays the first result; issuing again
	// returns the existing document in any case.
	@RequirePermissions("certificates.documents:issue")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.certificates.issue)
	async issue(@Session() session?: UserSession) {
		return implement(v1.certificates.issue).handler(({ input }) =>
			this.documentService.issueAsStaff(input, actorId(session))
		)
	}

	@RequirePermissions("certificates.own:read")
	@Implement(v1.certificates.mine)
	async mine(@Session() session?: UserSession) {
		return implement(v1.certificates.mine).handler(() =>
			this.documentService.listMine(actorId(session))
		)
	}

	// CRT-8. A second click finds the document no longer valid and answers 409.
	@RequirePermissions("certificates.documents:revoke")
	@Implement(v1.certificates.revoke)
	async revoke(@Session() session?: UserSession) {
		return implement(v1.certificates.revoke).handler(async ({ input }) => {
			const userId = actorId(session)
			return this.documentService.revoke(
				input.documentId,
				input.reason,
				userId,
				await this.scopeOf(userId)
			)
		})
	}

	@RequirePermissions("certificates.documents:revoke")
	@Implement(v1.certificates.reissue)
	async reissue(@Session() session?: UserSession) {
		return implement(v1.certificates.reissue).handler(async ({ input }) => {
			const userId = actorId(session)
			return this.documentService.reissue(input, userId, await this.scopeOf(userId))
		})
	}

	// CRT-6. The four seminar routes need the same permission as issuing a
	// document, and every session is checked against the caller's Scope.
	@RequirePermissions("certificates.documents:issue")
	@Implement(v1.certificates.seminarSessions)
	async seminarSessions(@Session() session?: UserSession) {
		return implement(v1.certificates.seminarSessions).handler(async ({ input }) => {
			const userId = actorId(session)
			return this.seminarSessionService.sessions(input, userId, await this.scopeOf(userId))
		})
	}

	@RequirePermissions("certificates.documents:issue")
	@Implement(v1.certificates.seminarRoster)
	async seminarRoster(@Session() session?: UserSession) {
		return implement(v1.certificates.seminarRoster).handler(async ({ input }) => {
			const userId = actorId(session)
			return this.seminarSessionService.roster(input, userId, await this.scopeOf(userId))
		})
	}

	// Marking again changes nothing, so a double click is harmless.
	@RequirePermissions("certificates.documents:issue")
	@Implement(v1.certificates.seminarAttendance)
	async seminarAttendance(@Session() session?: UserSession) {
		return implement(v1.certificates.seminarAttendance).handler(async ({ input }) => {
			const userId = actorId(session)
			return this.seminarSessionService.markAttendance(input, userId, await this.scopeOf(userId))
		})
	}

	// Idempotent like a single issue: an attendee who already holds a
	// certificate is reported as such and nothing new is created.
	@RequirePermissions("certificates.documents:issue")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.certificates.seminarIssue)
	async seminarIssue(@Session() session?: UserSession) {
		return implement(v1.certificates.seminarIssue).handler(async ({ input }) => {
			const userId = actorId(session)
			return this.seminarSessionService.issue(input, userId, await this.scopeOf(userId))
		})
	}

	// Public on purpose (TOR §VIII.4): anyone holding the document can scan
	// its QR code. The 128-bit token is the only key, the answer carries no
	// unmasked personal data, and the strict throttle slows any attempt to
	// guess tokens.
	@AllowAnonymous()
	@StrictThrottle()
	@Implement(v1.certificates.verify)
	async verify() {
		return implement(v1.certificates.verify).handler(({ input }) =>
			this.documentService.verify(input.token)
		)
	}

	// Public, for someone without a scanner: Document Number plus the code
	// under the QR code. Same throttle, same 404 for any wrong pair.
	@AllowAnonymous()
	@StrictThrottle()
	@Implement(v1.certificates.verifyByNumber)
	async verifyByNumber() {
		return implement(v1.certificates.verifyByNumber).handler(({ input }) =>
			this.documentService.verifyByNumber(input)
		)
	}
}
