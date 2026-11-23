import { Module } from "@nestjs/common"

import { FormsModule } from "@/modules/v1/forms/forms.module"
import { PoliciesModule } from "@/modules/v1/policies/policies.module"

import { BookingsController } from "./bookings.controller"
import { BookingService } from "./bookings.service"

@Module({
	// ADM-9: the booking API lists the written policies that apply to a Service.
	// FRM-2: the questionnaire and its file answers.
	imports: [PoliciesModule, FormsModule],
	controllers: [BookingsController],
	providers: [BookingService],
	// Exported so later epics (payments, processing) call its transition
	// methods instead of writing `bookings.status` themselves.
	exports: [BookingService],
})
export class BookingsModule {}
