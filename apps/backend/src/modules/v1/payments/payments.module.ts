import { Module } from "@nestjs/common"

import { PdfModule } from "@/common/pdf/pdf.module"
import { ScopeModule } from "@/common/scope/scope.module"

import { BookingsModule } from "../bookings/bookings.module"
import { CashierController } from "./cashier.controller"
import { CashierService } from "./cashier.service"
import { PaymentExceptionsController } from "./payment-exceptions.controller"
import { PaymentExceptionsService } from "./payment-exceptions.service"
import { PaymentChannelsController } from "./payment-channels.controller"
import { PaymentChannelService } from "./payment-channels.service"
import { PaymentNotificationsController } from "./payment-notifications.controller"
import { PaymentsController } from "./payments.controller"
import { PaymentService } from "./payments.service"
import { PAYMENT_PROVIDERS } from "./providers/payment-provider"
import { buildPaymentProviders, PaymentProviderRegistry } from "./providers/provider-registry"
import { ReceiptsController } from "./receipts.controller"
import { ReceiptService } from "./receipts.service"

@Module({
	imports: [BookingsModule, PdfModule, ScopeModule],
	controllers: [
		PaymentsController,
		PaymentNotificationsController,
		ReceiptsController,
		PaymentChannelsController,
		CashierController,
		PaymentExceptionsController,
	],
	providers: [
		PaymentService,
		PaymentChannelService,
		ReceiptService,
		CashierService,
		PaymentExceptionsService,
		PaymentProviderRegistry,
		{ provide: PAYMENT_PROVIDERS, useFactory: buildPaymentProviders },
	],
	// Exported so the cashier flow (PAY-4) and the re-query job (PAY-6) call
	// PaymentService instead of writing `payments` themselves.
	exports: [PaymentService, ReceiptService],
})
export class PaymentsModule {}
