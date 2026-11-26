import { Controller, UseInterceptors } from "@nestjs/common"
import { Implement } from "@orpc/nest"
import { implement } from "@orpc/server"
import { AllowAnonymous, Session, type UserSession } from "@thallesp/nestjs-better-auth"

import { v1 } from "@/config/api-versions.config"
import { RequirePermissions } from "@/shared/decorators/require-permissions.decorator"
import { StrictThrottle } from "@/shared/decorators/strict-throttle.decorator"
import { IdempotencyInterceptor } from "@/shared/interceptors/idempotency.interceptor"

import { AnnouncementService } from "./announcements.service"

export const ANNOUNCEMENTS_MANAGE = "settings.announcements:manage"

function actorId(session?: UserSession): string | null {
	return session?.user?.id ?? null
}

/**
 * AUTH-4: the Gender and Development flash screen. RbacGuard checks
 * settings.announcements:manage on every admin route (403 and a denied Audit
 * Entry without it). Announcements are nationwide, so there is no Scope check.
 * The active Announcement is public: it shows before anyone signs in.
 */
@Controller()
export class AnnouncementsController {
	constructor(private readonly announcementService: AnnouncementService) {}

	@RequirePermissions(ANNOUNCEMENTS_MANAGE)
	@Implement(v1.announcements.list)
	async list() {
		return implement(v1.announcements.list).handler(() => this.announcementService.list())
	}

	// Not idempotent by key: uploading the same file twice only stores a copy.
	@StrictThrottle()
	@RequirePermissions(ANNOUNCEMENTS_MANAGE)
	@Implement(v1.announcements.uploadMedia)
	async uploadMedia(@Session() session?: UserSession) {
		return implement(v1.announcements.uploadMedia).handler(({ input }) =>
			this.announcementService.uploadMedia(input.file, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions(ANNOUNCEMENTS_MANAGE)
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.announcements.create)
	async create(@Session() session?: UserSession) {
		return implement(v1.announcements.create).handler(({ input }) =>
			this.announcementService.create(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions(ANNOUNCEMENTS_MANAGE)
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.announcements.update)
	async update(@Session() session?: UserSession) {
		return implement(v1.announcements.update).handler(({ input }) =>
			this.announcementService.update(input, actorId(session))
		)
	}

	@StrictThrottle()
	@RequirePermissions(ANNOUNCEMENTS_MANAGE)
	@UseInterceptors(IdempotencyInterceptor)
	@Implement(v1.announcements.setActive)
	async setActive(@Session() session?: UserSession) {
		return implement(v1.announcements.setActive).handler(({ input }) =>
			this.announcementService.setActive(input.id, input.isActive, actorId(session))
		)
	}

	// Public on purpose: shown before sign-in. Only what BOQ publishes; default throttle.
	@AllowAnonymous()
	@Implement(v1.announcements.active)
	async active() {
		return implement(v1.announcements.active).handler(() => this.announcementService.active())
	}
}
