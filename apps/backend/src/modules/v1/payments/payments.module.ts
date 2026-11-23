import { Module } from "@nestjs/common"

import { PdfModule } from "@/common/pdf/pdf.module"

import { BookingsModule } from "../bookings/bookings.module"
import { PaymentNotificationsController } from "./payment-notifications.controller"
import { PaymentsController } from "./payments.controller"
import { PaymentService } from "./payments.service"
import { PAYMENT_PROVIDERS } from "./providers/payment-provider"
import { buildPaymentProviders, PaymentProviderRegistry } from "./providers/provider-registry"
import { ReceiptsController } from "./receipts.controller"
import { ReceiptService } from "./receipts.service"

@Module({
	imports: [BookingsModule, PdfModule],
	controllers: [PaymentsController, PaymentNotificationsController, ReceiptsController],
	providers: [
		PaymentService,
		ReceiptService,
		PaymentProviderRegistry,
		{ provide: PAYMENT_PROVIDERS, useFactory: buildPaymentProviders },
	],
	// Exported so the cashier flow (PAY-4) and the re-query job (PAY-6) call
	// PaymentService instead of writing `payments` themselves.
	exports: [PaymentService, ReceiptService],
})
export class PaymentsModule {}
