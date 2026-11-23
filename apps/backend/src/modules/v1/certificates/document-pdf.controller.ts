import {
	Controller,
	Get,
	HttpCode,
	Inject,
	Optional,
	Param,
	ParseIntPipe,
	Post,
	Res,
} from "@nestjs/common"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import { NO_SCOPE, SCOPE_RESOLVER, type ScopeResolver } from "@/common/scope/scope.token"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { DocumentService } from "./documents.service"

/** Headers for a PDF that carries personal data: shown inline, never cached by shared caches. */
function sendPdf(response: Response, fileName: string, pdf: Buffer): void {
	response.setHeader("Cache-Control", "private, no-store")
	response.setHeader("Content-Type", "application/pdf")
	response.setHeader("Content-Disposition", `inline; filename="${fileName}"`)
	response.setHeader("Content-Length", String(pdf.length))
	response.end(pdf)
}

/**
 * A document's PDF:
 * - GET /api/v1/certificates/documents/{documentId}/pdf, for the client who owns it.
 * - POST /api/v1/certificates/documents/{documentId}/print, for staff (CRT-3).
 *
 * Plain routes rather than oRPC because they answer with PDF bytes. The PDF
 * opens in the browser's PDF viewer, from which it can be printed.
 */
@Controller("v1/certificates/documents")
export class DocumentPdfController {
	constructor(
		private readonly documentService: DocumentService,
		@Optional() @Inject(SCOPE_RESOLVER) private readonly scopeResolver?: ScopeResolver
	) {}

	@RequirePermissions("certificates.own:read")
	@Get(":documentId/pdf")
	async download(
		@Param("documentId", ParseIntPipe) documentId: number,
		@Res() response: Response,
		@Session() session?: UserSession
	): Promise<void> {
		const { fileName, pdf } = await this.documentService.renderForOwner(
			documentId,
			session?.user?.id ?? null
		)
		sendPdf(response, fileName, pdf)
	}

	/**
	 * Print a document (CRT-3). POST, not GET, because every call is counted
	 * and audited as a print; a missing permission gets 403 and is audited by
	 * the RBAC guard. The vaccination record comes back laid out for the
	 * pre-printed card.
	 */
	@RequirePermissions("certificates.documents:print")
	@Post(":documentId/print")
	@HttpCode(200)
	async print(
		@Param("documentId", ParseIntPipe) documentId: number,
		@Res() response: Response,
		@Session() session?: UserSession
	): Promise<void> {
		const userId = session?.user?.id ?? null
		// ADM-2: no resolver wired in means no Scope, so a wiring mistake fails closed.
		const scope = this.scopeResolver ? await this.scopeResolver.resolve(userId) : NO_SCOPE
		const { fileName, pdf, printCount } = await this.documentService.printForStaff(
			documentId,
			userId,
			scope
		)
		response.setHeader("X-Print-Count", String(printCount))
		sendPdf(response, fileName, pdf)
	}
}
