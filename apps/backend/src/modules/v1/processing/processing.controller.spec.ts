import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { ProcessingController } from "./processing.controller"

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
		processing: {
			queue: {},
			item: {},
			checkIn: {},
			open: {},
			assess: {},
			approvals: {},
			decide: {},
			override: {},
		},
	},
}))
// The interceptor and the service both reach the database; these tests only
// check the controller's permission metadata.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./processing.service", () => ({
	ProcessingService: jest.fn(),
}))

describe("ProcessingController permissions", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the
	// key, 401 without a session (rbac.guard.spec.ts).
	it.each(["queue", "item"] as const)("requires processing.queue:read to %s", method => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ProcessingController.prototype[method])
		).toEqual(["processing.queue:read"])
	})

	it.each(["checkIn", "open", "assess"] as const)(
		"requires processing.assessments:perform to %s",
		method => {
			expect(
				Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ProcessingController.prototype[method])
			).toEqual(["processing.assessments:perform"])
		}
	)

	// PRC-3: Processing Officers do not hold this key (Annex A), so they get 403.
	it.each(["approvals", "decide", "override"] as const)(
		"requires processing.assessments:approve to %s",
		method => {
			expect(
				Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ProcessingController.prototype[method])
			).toEqual(["processing.assessments:approve"])
		}
	)
})
