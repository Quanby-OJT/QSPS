import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { PaymentChannelsController } from "./payment-channels.controller"

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
	v1: { paymentChannels: { list: {}, update: {} } },
}))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./payment-channels.service", () => ({
	PaymentChannelService: jest.fn(),
}))

describe("PaymentChannelsController permissions", () => {
	// RbacGuard reads this metadata: 401 without a session, 403 plus a denied
	// audit entry without the key (rbac.guard.spec.ts).
	it("requires settings.payment-channels:manage to change a channel", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PaymentChannelsController.prototype.update)
		).toEqual(["settings.payment-channels:manage"])
	})

	it("requires settings.payment-channels:manage to list channels", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PaymentChannelsController.prototype.list)
		).toEqual(["settings.payment-channels:manage"])
	})
})
