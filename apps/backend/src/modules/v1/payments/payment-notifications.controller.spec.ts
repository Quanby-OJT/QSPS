import { NotFoundException, UnauthorizedException } from "@nestjs/common"

import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { PaymentNotificationsController } from "./payment-notifications.controller"
import type { PaymentService } from "./payments.service"

// The real decorator stores the same "PUBLIC" metadata SessionAuthGuard reads.
jest.mock("@thallesp/nestjs-better-auth", () => {
	const { SetMetadata } = jest.requireActual("@nestjs/common") as {
		SetMetadata: (key: string, value: unknown) => MethodDecorator
	}
	return { AllowAnonymous: () => SetMetadata("PUBLIC", true) }
})
jest.mock("./payments.service", () => ({
	PaymentService: jest.fn(),
}))

function request(rawBody: string, headers: Record<string, string> = {}) {
	return { rawBody: Buffer.from(rawBody, "utf8"), headers } as never
}

describe("PaymentNotificationsController", () => {
	let handleNotification: jest.Mock
	let controller: PaymentNotificationsController

	beforeEach(() => {
		handleNotification = jest.fn()
		controller = new PaymentNotificationsController({
			handleNotification,
		} as unknown as PaymentService)
	})

	it("is public and needs no permission key: gateways have no session", () => {
		const handler = PaymentNotificationsController.prototype.receive
		expect(Reflect.getMetadata("PUBLIC", handler)).toBe(true)
		expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toBeUndefined()
	})

	it("passes the exact body bytes and lower-case headers to the service", async () => {
		handleNotification.mockResolvedValue("processed")

		await expect(
			controller.receive("fake", request('{"a": 1}', { "X-Fake-Signature": "abc" }))
		).resolves.toEqual({ received: true })
		expect(handleNotification).toHaveBeenCalledWith("fake", {
			headers: { "x-fake-signature": "abc" },
			rawBody: '{"a": 1}',
		})
	})

	it("acknowledges a duplicate so the gateway stops resending it", async () => {
		handleNotification.mockResolvedValue("duplicate")
		await expect(controller.receive("fake", request("{}"))).resolves.toEqual({ received: true })
	})

	it("answers 401 for a bad signature", async () => {
		handleNotification.mockResolvedValue("invalid_signature")
		await expect(controller.receive("fake", request("{}"))).rejects.toBeInstanceOf(
			UnauthorizedException
		)
	})

	it("answers 404 for an unknown provider", async () => {
		handleNotification.mockResolvedValue("unknown_provider")
		await expect(controller.receive("nope", request("{}"))).rejects.toBeInstanceOf(
			NotFoundException
		)
	})
})
