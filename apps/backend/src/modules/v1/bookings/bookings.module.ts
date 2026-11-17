import { Module } from "@nestjs/common"

import { BookingsController } from "./bookings.controller"
import { BookingService } from "./bookings.service"

@Module({
	controllers: [BookingsController],
	providers: [BookingService],
	// Exported so later epics (payments, processing) call its transition
	// methods instead of writing `bookings.status` themselves.
	exports: [BookingService],
})
export class BookingsModule {}
