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
			policies: {},
			unpaid: {},
			cancel: {},
			payOnsite: {},
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
jest.mock("@/modules/v1/policies/policy-documents.service", () => ({
	PolicyDocumentService: jest.fn(),
}))

describe("BookingsController permissions", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the
	// key, 401 without a session (rbac.guard.spec.ts).
	it("requires bookings.own:create to book", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.create)
		).toEqual(["bookings.own:create"])
	})

	it("requires bookings.own:create to read the policies that apply (ADM-9)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.policies)
		).toEqual(["bookings.own:create"])
	})

	it("requires bookings.own:read to see the booking awaiting payment (BKG-2)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.unpaid)
		).toEqual(["bookings.own:read"])
	})

	it("requires bookings.own:cancel to cancel (BKG-2)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.cancel)
		).toEqual(["bookings.own:cancel"])
	})

	it("requires payments.own:create to choose paying at the office (BKG-2)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.payOnsite)
		).toEqual(["payments.own:create"])
	})
})

// FRM-2: the controller's upload dependency; its rules are tested in form-uploads.service.spec.
jest.mock("@/modules/v1/forms/form-uploads.service", () => ({ FormUploadService: jest.fn() }))

jest.mock("@/modules/v1/forms/form-submissions.service", () => ({
	FormSubmissionService: jest.fn(),
}))
