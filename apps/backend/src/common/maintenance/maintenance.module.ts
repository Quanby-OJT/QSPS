import { Module } from "@nestjs/common"
import { ScheduleModule } from "@nestjs/schedule"

import { BookingsModule } from "@/modules/v1/bookings/bookings.module"

import { BookingExpiryService } from "./booking-expiry.service"
import { ExpiryCleanupService } from "./expiry-cleanup.service"

/**
 * Scheduled housekeeping.
 *
 * Owns the single scheduler registration. The expired-`verifications` sweep
 * belongs in {@link ExpiryCleanupService}, not in a second scheduler.
 * {@link BookingExpiryService} (BKG-2) runs on the same scheduler every
 * minute and changes Bookings only through `BookingService`.
 */
@Module({
	imports: [ScheduleModule.forRoot(), BookingsModule],
	providers: [ExpiryCleanupService, BookingExpiryService],
	exports: [ExpiryCleanupService, BookingExpiryService],
})
export class MaintenanceModule {}
