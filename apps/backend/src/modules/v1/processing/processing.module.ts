import { Module } from "@nestjs/common"

import { BookingsModule } from "../bookings/bookings.module"
import { ProcessingController } from "./processing.controller"
import { ProcessingService } from "./processing.service"

@Module({
	// Item status changes go through BookingService (DOMAIN-MODEL.md section 6).
	imports: [BookingsModule],
	controllers: [ProcessingController],
	providers: [ProcessingService],
})
export class ProcessingModule {}
