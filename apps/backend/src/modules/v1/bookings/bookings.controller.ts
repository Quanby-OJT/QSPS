import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { FormSubmissionService } from "@/modules/v1/forms/form-submissions.service"
import { FormUploadService } from "@/modules/v1/forms/form-uploads.service"
import { PolicyDocumentService } from "@/modules/v1/policies/policy-documents.service"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { BookingService } from "./bookings.service"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

@Controller()
export class BookingsController {
	constructor(
		private readonly bookingService: BookingService,
		private readonly policyDocumentService: PolicyDocumentService,
		private readonly formUploadService: FormUploadService,
		private readonly formSubmissionService: FormSubmissionService
	) {}

	// ADM-9: what the client must read, and may have to accept, before booking
	// this Service. The web review step and the mobile app both use it.
	@RequirePermissions("bookings.own:create")
	@Implement(v1.bookings.policies)
	async policies() {
		return implement(v1.bookings.policies).handler(({ input }) =>
			this.policyDocumentService.forService(input.serviceId)
		)
	}

	// BKG-4: list all bookings owned by the signed-in client, newest first.
	@RequirePermissions("bookings.own:read")
	@Implement(v1.bookings.listOwn)
	async listOwn(@Session() session?: UserSession) {
		return implement(v1.bookings.listOwn).handler(() =>
			this.bookingService.listOwn(actorId(session))
		)
	}

	// BKG-4: read one booking owned by the signed-in client (404 when not owner).
	@RequirePermissions("bookings.own:read")
	@Implement(v1.bookings.getOwn)
	async getOwn(@Session() session?: UserSession) {
		return implement(v1.bookings.getOwn).handler(({ input }) =>
			this.bookingService.getOwn(input.bookingId, actorId(session))
		)
	}

	// FRM-2: the questionnaire the wizard shows for a Service, or null.
	@RequirePermissions("bookings.own:create")
	@Implement(v1.bookings.form)
	async form() {
		return implement(v1.bookings.form).handler(({ input }) =>
			this.formSubmissionService.forService(input.serviceId)
		)
	}

	// FRM-2: a file answer, stored privately under the caller's own folder.
	// Not idempotent by key: uploading the same file twice only stores a copy.
	@StrictThrottle()
	@RequirePermissions("bookings.own:create")
	@Implement(v1.bookings.uploadFormFile)
	async uploadFormFile(@Session() session?: UserSession) {
		return implement(v1.bookings.uploadFormFile).handler(({ input }) =>
			this.formUploadService.upload(input.file, actorId(session))
		)
	}

	// FRM-2: change answers before paying; refused once the booking is paid.
	@StrictThrottle()
	@RequirePermissions("bookings.own:create")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.bookings.updateItemForm)
	async updateItemForm(@Session() session?: UserSession) {
		return implement(v1.bookings.updateItemForm).handler(({ input }) =>
			this.bookingService.updateItemForm(input, actorId(session))
		)
	}

	// BKG-2: the client's one booking awaiting payment, or null.
	@RequirePermissions("bookings.own:read")
	@Implement(v1.bookings.unpaid)
	async unpaid(@Session() session?: UserSession) {
		return implement(v1.bookings.unpaid).handler(() =>
			this.bookingService.findUnpaid(actorId(session))
		)
	}


	// BKG-2: the client cancels their own unpaid booking, freeing the place.
	@StrictThrottle()
	@RequirePermissions("bookings.own:cancel")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.bookings.cancel)
	async cancel(@Session() session?: UserSession) {
		return implement(v1.bookings.cancel).handler(({ input }) =>
			this.bookingService.cancelOwn(input.bookingId, actorId(session))
		)
	}

	// BKG-2: pay at the BOQ cashier; the arrival cutoff replaces the hold.
	@StrictThrottle()
	@RequirePermissions("payments.own:create")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.bookings.payOnsite)
	async payOnsite(@Session() session?: UserSession) {
		return implement(v1.bookings.payOnsite).handler(({ input }) =>
			this.bookingService.choosePayOnsite(input.bookingId, actorId(session))
		)
	}

	// BKG-5: move one booked item in a pending_payment or paid booking to another
	// open slot for the same service and location.
	@StrictThrottle()
	@RequirePermissions("bookings.own:reschedule")
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.bookings.rescheduleItem)
	async rescheduleItem(@Session() session?: UserSession) {
		return implement(v1.bookings.rescheduleItem).handler(({ input }) =>
			this.bookingService.rescheduleItem(input, actorId(session))
		)
	}

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