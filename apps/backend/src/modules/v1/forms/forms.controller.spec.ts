import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { FormsController } from "./forms.controller"

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
		forms: {
			listServices: {},
			listVersions: {},
			get: {},
			createDraft: {},
			saveFields: {},
			publish: {},
			setActive: {},
			delete: {},
		},
	},
}))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./forms.service", () => ({
	FormsService: jest.fn(),
}))

describe("FormsController permissions", () => {
	// RbacGuard reads this metadata: 401 without a session, 403 plus a denied
	// audit entry without the key (rbac.guard.spec.ts).
	it.each([
		"listServices",
		"listVersions",
		"get",
		"createDraft",
		"saveFields",
		"publish",
		"setActive",
		"delete",
	] as const)("requires forms.templates:manage for %s", method => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, FormsController.prototype[method])
		).toEqual(["forms.templates:manage"])
	})
})
