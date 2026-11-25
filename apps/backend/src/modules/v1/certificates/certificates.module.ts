import { Module } from "@nestjs/common"

import { PdfModule } from "@/common/pdf/pdf.module"
import { RbacModule } from "@/common/rbac/rbac.module"
import { RbacService } from "@/common/rbac/rbac.service"
import { ScopeModule } from "@/common/scope/scope.module"
import { ScopeService } from "@/common/scope/scope.service"

import { BookingsModule } from "../bookings/bookings.module"
import { CertificatesController } from "./certificates.controller"
import { DocumentPdfController } from "./document-pdf.controller"
import { DocumentService } from "./documents.service"
import { PE_RBAC, PE_SCOPE } from "./pe-access.tokens"
import { PrintoutsController } from "./printouts/printouts.controller"
import { PrintoutService } from "./printouts/printouts.service"
import { SeminarSessionService } from "./seminars/seminar-sessions.service"

@Module({
	// Item and Booking status changes go through BookingService (DOMAIN-MODEL.md section 6).
	// ScopeModule: staff print only documents in their Scope (CRT-3).
	imports: [BookingsModule, PdfModule, RbacModule, ScopeModule],
	controllers: [CertificatesController, DocumentPdfController, PrintoutsController],
	// CRT-6: SeminarSessionService marks attendance and issues certificates for a seminar roster.
	providers: [
		DocumentService,
		PrintoutService,
		SeminarSessionService,
		{ provide: PE_RBAC, useExisting: RbacService },
		{ provide: PE_SCOPE, useExisting: ScopeService },
	],
	// Exported so processing can auto-issue inside the clearing transaction.
	exports: [DocumentService],
})
export class CertificatesModule {}
