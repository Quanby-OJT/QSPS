import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { PaymentExceptionsController } from "./payment-exceptions.controller"

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
	v1: { paymentExceptions: { list: {}, resolve: {} } },
}))
jest.mock("./payment-exceptions.service", () => ({
	PaymentExceptionsService: jest.fn(),
}))

describe("PaymentExceptionsController permissions (PAY-6)", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the key.
	it("needs payments.transactions:read to see the exceptions list", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PaymentExceptionsController.prototype.list)
		).toEqual(["payments.transactions:read"])
	})

	it("needs bookings.all:override to resolve an exception", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PaymentExceptionsController.prototype.resolve)
		).toEqual(["bookings.all:override"])
	})
})
