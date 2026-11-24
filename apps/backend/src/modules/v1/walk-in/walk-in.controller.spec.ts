import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { WalkInController } from "./walk-in.controller"

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
		walkIn: {
			lookupClients: {},
			createClient: {},
			slots: {},
			policies: {},
			form: {},
			uploadFormFile: {},
			createBooking: {},
		},
	},
}))
// The interceptor and the services reach the database; these tests only check
// the controller's permission metadata.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./walk-in.service", () => ({ WalkInService: jest.fn() }))
jest.mock("../policies/policy-documents.service", () => ({ PolicyDocumentService: jest.fn() }))
jest.mock("../forms/form-submissions.service", () => ({ FormSubmissionService: jest.fn() }))
jest.mock("../forms/form-uploads.service", () => ({ FormUploadService: jest.fn() }))

const ROUTES = [
	"lookupClients",
	"createClient",
	"slots",
	"policies",
	"form",
	"uploadFormFile",
	"createBooking",
] as const

describe("WalkInController permissions (PRC-2)", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the
	// key, 401 without a session (rbac.guard.spec.ts).
	it.each(ROUTES)("requires bookings.walk-in:create for %s", route => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, WalkInController.prototype[route])
		).toEqual(["bookings.walk-in:create"])
	})
})
