import { Module } from "@nestjs/common"

import { ScopeModule } from "@/common/scope/scope.module"
import { StorageModule } from "@/common/storage/storage.module"

import { BookingsModule } from "../bookings/bookings.module"
import { CertificatesModule } from "../certificates/certificates.module"
import { ProcessingController } from "./processing.controller"
import { ProcessingService } from "./processing.service"

@Module({
	// Item status changes go through BookingService (DOMAIN-MODEL.md section 6);
	// documents are issued on clearance through DocumentService (CRT-1).
	imports: [StorageModule, BookingsModule, CertificatesModule, ScopeModule],
	controllers: [ProcessingController],
	providers: [ProcessingService],
})
export class ProcessingModule {}
