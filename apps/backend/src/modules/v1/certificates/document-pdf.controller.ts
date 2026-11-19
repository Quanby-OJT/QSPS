import { Controller, Get, Param, ParseIntPipe, Res } from "@nestjs/common"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"
import type { Response } from "express"

import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"

import { DocumentService } from "./documents.service"

/**
 * A document's PDF: GET /api/v1/certificates/documents/{documentId}/pdf.
 *
 * A plain route rather than oRPC because it answers with PDF bytes. Opens in
 * the browser's PDF viewer, from which it can be downloaded or printed.
 */
@Controller("v1/certificates/documents")
export class DocumentPdfController {
	constructor(private readonly documentService: DocumentService) {}

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
		// A document carries personal data: never cache it in shared caches.
		response.setHeader("Cache-Control", "private, no-store")
		response.setHeader("Content-Type", "application/pdf")
		response.setHeader("Content-Disposition", `inline; filename="${fileName}"`)
		response.setHeader("Content-Length", String(pdf.length))
		response.end(pdf)
	}
}
