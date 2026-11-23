import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { PaymentChannelService } from "./payment-channels.service"

/**
 * Payment channel settings (PAY-5). Both routes need
 * `settings.payment-channels:manage`; RbacGuard answers 403 and audits the
 * denial for anyone without it.
 */
@Controller()
export class PaymentChannelsController {
	constructor(private readonly channelService: PaymentChannelService) {}

	@RequirePermissions("settings.payment-channels:manage")
	@Implement(v1.paymentChannels.list)
	async list() {
		return implement(v1.paymentChannels.list).handler(() => this.channelService.listForSettings())
	}

	@StrictThrottle()
	@RequirePermissions("settings.payment-channels:manage")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.paymentChannels.update)
	async update(@Session() session?: UserSession) {
		return implement(v1.paymentChannels.update).handler(({ input }) =>
			this.channelService.update(input, session?.user?.id ?? null)
		)
	}
}
