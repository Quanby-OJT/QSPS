import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { BookingService } from "./bookings.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

@Controller()
export class BookingsController {
	constructor(private readonly bookingService: BookingService) {}

	// Idempotent: a retried confirm with the same Idempotency-Key replays the
	// first response instead of booking a second place.
	@StrictThrottle()
	@RequirePermissions("bookings.own:create")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.bookings.create)
	async create(@Session() session?: UserSession) {
		return implement(v1.bookings.create).handler(({ input }) =>
			this.bookingService.create(input, actorId(session))
		)
	}
}
