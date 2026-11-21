import type { PolicyService } from "@/common/policy/policy.service"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { PoliciesController } from "./policies.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

/** What the next oRPC handler call receives as its `{ input }`. */
let handlerInput: unknown

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: jest.fn((fn: (options: { input: unknown }) => unknown) => fn({ input: handlerInput })),
	})),
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: {
		policies: {
			list: {},
			update: {},
		},
	},
}))

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))

jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))

jest.mock("@/common/policy/policy.service", () => ({
	PolicyService: jest.fn(),
}))

function requiredPermissions(handler: keyof PoliciesController): unknown {
	return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, PoliciesController.prototype[handler])
}

describe("PoliciesController", () => {
	let service: { list: jest.Mock; set: jest.Mock }
	let controller: PoliciesController

	beforeEach(() => {
		handlerInput = undefined
		service = { list: jest.fn(), set: jest.fn() }
		controller = new PoliciesController(service as unknown as PolicyService)
	})

	// RbacGuard reads this metadata and answers 403 plus a denied Audit Entry
	// when the caller lacks the key (Flow A).
	it.each(["list", "update"] as const)("requires settings.policies:manage on %s", handler => {
		expect(requiredPermissions(handler)).toEqual(["settings.policies:manage"])
	})

	it("lists every policy", async () => {
		service.list.mockResolvedValue([{ key: "booking.hold_minutes" }])

		await expect(controller.list()).resolves.toEqual([{ key: "booking.hold_minutes" }])
	})

	it("attributes a change to the signed-in user", async () => {
		handlerInput = { key: "booking.hold_minutes", value: 90 }
		service.set.mockResolvedValue({ key: "booking.hold_minutes", value: 90 })

		await controller.update({ user: { id: "admin-1" } } as never)

		expect(service.set).toHaveBeenCalledWith("booking.hold_minutes", 90, "admin-1")
	})
})
