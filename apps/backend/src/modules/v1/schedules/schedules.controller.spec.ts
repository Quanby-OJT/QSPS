import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { SchedulesController } from "./schedules.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))
jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({ handler: jest.fn() })),
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		schedules: {
			listSlots: {},
			listAvailability: {},
			generateSlots: {},
			updateSlotCapacity: {},
			setSlotDisabled: {},
			deleteSlot: {},
		},
	},
}))
// The interceptor and the service both reach the database; these tests only
// check the controller's permission metadata.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./schedules.service", () => ({
	SchedulesService: jest.fn(),
}))

const MANAGE_KEY = "schedules.slots:manage"

const permissionsOn = (method: keyof SchedulesController): unknown =>
	Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, SchedulesController.prototype[method])

describe("SchedulesController permissions", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the
	// key, 401 without a session (rbac.guard.spec.ts).
	it.each(["generateSlots", "updateSlotCapacity", "setSlotDisabled", "deleteSlot"] as const)(
		"requires %s to hold the manage key",
		method => {
			expect(permissionsOn(method)).toEqual([MANAGE_KEY])
		}
	)

	it("requires the manage key to list every slot, disabled ones included", () => {
		expect(permissionsOn("listSlots")).toEqual([MANAGE_KEY])
	})

	it("leaves availability open to any signed-in user", () => {
		expect(permissionsOn("listAvailability")).toBeUndefined()
	})
})
