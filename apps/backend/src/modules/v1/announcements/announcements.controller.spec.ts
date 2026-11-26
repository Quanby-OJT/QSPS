import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { AnnouncementMediaController } from "./announcement-media.controller"
import { ANNOUNCEMENTS_MANAGE, AnnouncementsController } from "./announcements.controller"

// Jest cannot load these ESM packages; the decorators under test are Nest's own.
jest.mock("@thallesp/nestjs-better-auth", () => ({
	AllowAnonymous: () => () => undefined,
	Session: () => () => undefined,
}))
jest.mock("@orpc/nest", () => ({ Implement: () => () => undefined }))
jest.mock("@orpc/server", () => ({ implement: jest.fn(), ORPCError: class extends Error {} }))
jest.mock("@repo/contracts", () => ({ ANNOUNCEMENT_MEDIA_TYPES: {} }))
jest.mock("@/config/api-versions.config", () => ({ v1: { announcements: {} } }))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class {},
}))
jest.mock("./announcements.service", () => ({ AnnouncementService: class {} }))

function required(handler: unknown): unknown {
	return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler as object)
}

describe("AUTH-4 announcement routes", () => {
	it.each(["list", "uploadMedia", "create", "update", "setActive"] as const)(
		"%s requires settings.announcements:manage",
		name => {
			expect(required(AnnouncementsController.prototype[name])).toEqual([ANNOUNCEMENTS_MANAGE])
		}
	)

	it("the media preview requires settings.announcements:manage", () => {
		expect(required(AnnouncementMediaController.prototype.preview)).toEqual([ANNOUNCEMENTS_MANAGE])
	})

	it("the active announcement and its public media need no permission", () => {
		expect(required(AnnouncementsController.prototype.active)).toBeUndefined()
		expect(required(AnnouncementMediaController.prototype.media)).toBeUndefined()
	})
})
