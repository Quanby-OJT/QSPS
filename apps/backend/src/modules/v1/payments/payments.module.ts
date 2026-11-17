import { Module } from "@nestjs/common"

import { BookingsModule } from "../bookings/bookings.module"
import { PaymentNotificationsController } from "./payment-notifications.controller"
import { PaymentsController } from "./payments.controller"
import { PaymentService } from "./payments.service"
import { PAYMENT_PROVIDERS } from "./providers/payment-provider"
import { buildPaymentProviders, PaymentProviderRegistry } from "./providers/provider-registry"

@Module({
	imports: [BookingsModule],
	controllers: [PaymentsController, PaymentNotificationsController],
	providers: [
		PaymentService,
		PaymentProviderRegistry,
		{ provide: PAYMENT_PROVIDERS, useFactory: buildPaymentProviders },
	],
	// Exported so the cashier flow (PAY-4) and the re-query job (PAY-6) call
	// PaymentService instead of writing `payments` themselves.
	exports: [PaymentService],
})
export class PaymentsModule {}
