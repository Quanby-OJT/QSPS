import { Module } from "@nestjs/common"

import { ScopeModule } from "@/common/scope/scope.module"
import { FormsModule } from "@/modules/v1/forms/forms.module"
import { PoliciesModule } from "@/modules/v1/policies/policies.module"

import { BookingsModule } from "../bookings/bookings.module"
import { WalkInController } from "./walk-in.controller"
import { WalkInService } from "./walk-in.service"

/**
 * PRC-2: walk-in clients encoded by a Processing Officer. The Booking goes
 * through BookingService (DOMAIN-MODEL.md section 6); the questionnaire and
 * policies are the same as online booking (FRM-2, ADM-9).
 */
@Module({
	imports: [BookingsModule, FormsModule, PoliciesModule, ScopeModule],
	controllers: [WalkInController],
	providers: [WalkInService],
})
export class WalkInModule {}
