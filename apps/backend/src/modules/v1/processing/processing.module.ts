import { Module } from "@nestjs/common"

import { PdfModule } from "@/common/pdf/pdf.module"
import { ScopeModule } from "@/common/scope/scope.module"
import { StorageModule } from "@/common/storage/storage.module"

import { BookingsModule } from "../bookings/bookings.module"
import { CertificatesModule } from "../certificates/certificates.module"
import { ProcessingController } from "./processing.controller"
import { ProcessingService } from "./processing.service"
import { PeResultsController } from "./steps/pe-results.controller"
import { ServiceStepsService } from "./steps/service-steps.service"
import { StepResultsService } from "./steps/step-results.service"
import { StepsController } from "./steps/steps.controller"

@Module({
	// Item status changes go through BookingService (DOMAIN-MODEL.md section 6);
	// documents are issued on clearance through DocumentService (CRT-1).
	// PRC-4: Service Steps and their results, with a printable result (PdfModule).
	imports: [StorageModule, BookingsModule, CertificatesModule, ScopeModule, PdfModule],
	controllers: [ProcessingController, StepsController, PeResultsController],
	providers: [ProcessingService, ServiceStepsService, StepResultsService],
})
export class ProcessingModule {}
