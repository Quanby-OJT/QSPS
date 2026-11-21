import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { DocumentService } from "./documents.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * Documents (CRT-1, CRT-2). RbacGuard checks the permission key (403 and a
 * denied Audit Entry without it); DocumentService checks the Location or the
 * owner. The two verify routes are public.
 */
@Controller()
export class CertificatesController {
	constructor(private readonly documentService: DocumentService) {}

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
