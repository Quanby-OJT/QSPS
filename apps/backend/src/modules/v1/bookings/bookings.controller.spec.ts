import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { BookingsController } from "./bookings.controller"

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
		bookings: {
			create: {},
		},
	},
}))
// The interceptor and the service both reach the database; these tests only
// check the controller's permission metadata.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./bookings.service", () => ({
	BookingService: jest.fn(),
}))

describe("BookingsController permissions", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the
	// key, 401 without a session (rbac.guard.spec.ts).
	it("requires bookings.own:create to book", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.create)
		).toEqual(["bookings.own:create"])
	})
})
