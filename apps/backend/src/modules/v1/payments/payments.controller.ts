import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { PaymentChannelService } from "./payment-channels.service"
import { PaymentService } from "./payments.service"
import { ReceiptService } from "./receipts.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

@Controller()
export class PaymentsController {
	constructor(
		private readonly paymentService: PaymentService,
		private readonly receiptService: ReceiptService,
		private readonly channelService: PaymentChannelService
	) {}

	// Idempotent: a double click or a retried request with the same
	// Idempotency-Key replays the first checkout instead of opening a second.
	@StrictThrottle()
	@RequirePermissions("payments.own:create")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.payments.create)
	async create(@Session() session?: UserSession) {
		return implement(v1.payments.create).handler(({ input }) =>
			this.paymentService.create(input, actorId(session))
		)
	}

	// Read-only. The same key as paying: whoever may pay a booking may watch
	// that payment; ownership is checked in the service.
	@RequirePermissions("payments.own:create")
	@Implement(v1.payments.status)
	async status(@Session() session?: UserSession) {
		return implement(v1.payments.status).handler(({ input }) =>
			this.paymentService.getStatus(input.paymentId, actorId(session))
		)
	}

	// Public on purpose: anyone holding the receipt can scan its QR code.
	// The 128-bit token is the only key; the answer carries no personal data,
	// and the strict throttle slows any attempt to guess tokens.
	@AllowAnonymous()
	@StrictThrottle()
	@Implement(v1.payments.verifyReceipt)
	async verifyReceipt() {
		return implement(v1.payments.verifyReceipt).handler(({ input }) =>
			this.receiptService.verify(input.token)
		)
	}

	// The client picks a channel at checkout and sees its fee first (PAY-5).
	// Same key as paying; ownership of the booking is checked in the service.
	@RequirePermissions("payments.own:create")
	@Implement(v1.payments.checkoutChannels)
	async checkoutChannels(@Session() session?: UserSession) {
		return implement(v1.payments.checkoutChannels).handler(({ input }) =>
			this.channelService.checkoutChannels(input.bookingId, actorId(session))
		)
	}
}
