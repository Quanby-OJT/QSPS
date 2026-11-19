import { Module } from "@nestjs/common"

import { PdfModule } from "@/common/pdf/pdf.module"

import { BookingsModule } from "../bookings/bookings.module"
import { CertificatesController } from "./certificates.controller"
import { DocumentPdfController } from "./document-pdf.controller"
import { DocumentService } from "./documents.service"

@Module({
	// Item and Booking status changes go through BookingService (DOMAIN-MODEL.md section 6).
	imports: [BookingsModule, PdfModule],
	controllers: [CertificatesController, DocumentPdfController],
	providers: [DocumentService],
	// Exported so processing can auto-issue inside the clearing transaction.
	exports: [DocumentService],
})
export class CertificatesModule {}
