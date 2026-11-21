import { Module } from "@nestjs/common"

import { BookingsModule } from "../bookings/bookings.module"
import { CertificatesModule } from "../certificates/certificates.module"
import { ProcessingController } from "./processing.controller"
import { ProcessingService } from "./processing.service"

@Module({
	// Item status changes go through BookingService (DOMAIN-MODEL.md section 6);
	// documents are issued on clearance through DocumentService (CRT-1).
	imports: [BookingsModule, CertificatesModule],
	controllers: [ProcessingController],
	providers: [ProcessingService],
})
export class ProcessingModule {}
