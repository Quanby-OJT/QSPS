import { Module } from "@nestjs/common"
import { ScheduleModule } from "@nestjs/schedule"

import { BookingsModule } from "@/modules/v1/bookings/bookings.module"
import { PaymentsModule } from "@/modules/v1/payments/payments.module"

import { BookingExpiryService } from "./booking-expiry.service"
import { ExpiryCleanupService } from "./expiry-cleanup.service"
import { PaymentReconciliationService } from "./payment-reconciliation.service"

/**
 * Scheduled housekeeping.
 *
 * Owns the single scheduler registration. The expired-`verifications` sweep
 * belongs in {@link ExpiryCleanupService}, not in a second scheduler.
 * {@link BookingExpiryService} (BKG-2) runs on the same scheduler every
 * minute and changes Bookings only through `BookingService`.
 * {@link PaymentReconciliationService} (PAY-6) re-checks stuck payments every
 * 5 minutes and changes Payments only through `PaymentService`.
 */
@Module({
	imports: [ScheduleModule.forRoot(), BookingsModule, PaymentsModule],
	providers: [ExpiryCleanupService, BookingExpiryService, PaymentReconciliationService],
	exports: [ExpiryCleanupService, BookingExpiryService, PaymentReconciliationService],
})
export class MaintenanceModule {}
