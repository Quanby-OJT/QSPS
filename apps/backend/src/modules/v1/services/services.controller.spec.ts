import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { ServicesController } from "./services.controller"

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
		services: {
			listCategories: {},
			list: {},
			listAvailable: {},
			create: {},
			update: {},
			setActive: {},
		},
	},
}))
// The interceptor and the service both reach the database; these tests only
// check the controller's permission metadata.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./services.service", () => ({
	ServicesService: jest.fn(),
}))

const MANAGE_KEY = "settings.services:manage"

const permissionsOn = (method: keyof ServicesController): unknown =>
	Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ServicesController.prototype[method])

describe("ServicesController permissions", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the
	// key, 401 without a session (rbac.guard.spec.ts).
	it.each(["create", "update", "setActive"] as const)("requires %s to hold the manage key", method => {
		expect(permissionsOn(method)).toEqual([MANAGE_KEY])
	})

	it("requires the manage key to list every service, inactive ones included", () => {
		expect(permissionsOn("list")).toEqual([MANAGE_KEY])
	})

	it.each(["listAvailable", "listCategories"] as const)(
		"leaves %s open to any signed-in user",
		method => {
			expect(permissionsOn(method)).toBeUndefined()
		}
	)
})