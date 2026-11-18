import { Module } from "@nestjs/common"

import { PdfService } from "./pdf.service"

/** Shared PDF rendering. Import it where documents are produced. */
@Module({
	providers: [PdfService],
	exports: [PdfService],
})
export class PdfModule {}
