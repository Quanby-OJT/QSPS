import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { DocumentService } from "./documents.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * Documents (CRT-1). RbacGuard checks the permission key (403 and a denied
 * Audit Entry without it); DocumentService checks the Location or the owner.
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
}
