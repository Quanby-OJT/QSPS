import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { CashierController } from "./cashier.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))
jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({ handler: jest.fn() })),
	ORPCError: class ORPCError extends Error {},
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: { cashier: { search: {}, get: {}, collect: {} } },
}))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./cashier.service", () => ({
	CashierService: jest.fn(),
}))

describe("CashierController permissions (PAY-4)", () => {
	// RbacGuard reads this metadata: 401 without a session, 403 plus a denied
	// audit entry without the key (rbac.guard.spec.ts).
	it.each(["search", "get", "collect", "receipt"] as const)(
		"requires payments.onsite:collect for %s",
		method => {
			expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CashierController.prototype[method])).toEqual([
				"payments.onsite:collect",
			])
		}
	)

	it("has no route that edits a client or a schedule", () => {
		const methods = Object.getOwnPropertyNames(CashierController.prototype).filter(
			name => name !== "constructor" && name !== "scopeOf"
		)
		expect(methods.sort()).toEqual(["collect", "get", "receipt", "search"])
	})
})
