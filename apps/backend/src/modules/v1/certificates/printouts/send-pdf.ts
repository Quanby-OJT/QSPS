import type { Response } from "express"

/**
 * Headers for a PDF that carries personal data: shown inline, never cached by
 * shared caches. Same as the helper in `document-pdf.controller.ts`; kept here
 * so CRT-4 does not edit CRT-3's file. Merge the two if the team prefers.
 */
export function sendPdf(response: Response, fileName: string, pdf: Buffer): void {
	response.setHeader("Cache-Control", "private, no-store")
	response.setHeader("Content-Type", "application/pdf")
	response.setHeader("Content-Disposition", `inline; filename="${fileName}"`)
	response.setHeader("Content-Length", String(pdf.length))
	response.end(pdf)
}
