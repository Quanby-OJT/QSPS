import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { PaymentsController } from "./payments.controller"

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
	v1: { payments: { create: {}, status: {} } },
}))
// The interceptor and the service both reach the database; these tests only
// check the controller's permission metadata.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./payments.service", () => ({
	PaymentService: jest.fn(),
}))

describe("PaymentsController permissions", () => {
	// RbacGuard reads this metadata: 401 without a session, 403 plus a denied
	// audit entry without the key (rbac.guard.spec.ts).
	it("requires payments.own:create to pay", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PaymentsController.prototype.create)
		).toEqual(["payments.own:create"])
	})

	it("requires payments.own:create to read a payment's status", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PaymentsController.prototype.status)
		).toEqual(["payments.own:create"])
	})
})
