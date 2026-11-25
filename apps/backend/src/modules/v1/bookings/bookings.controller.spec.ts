import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { BookingsController } from "./bookings.controller"
import type { BookingService } from "./bookings.service"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))
// The handler is returned as is, so a test can call it with an input.
jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: (fn: (context: { input: unknown }) => unknown) => fn,
	})),
}))
jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))
jest.mock("@/config/api-versions.config", () => ({
	v1: {
		bookings: {
			create: {},
			listOwn: {},
			getOwn: {},
			policies: {},
			form: {},
			uploadFormFile: {},
			updateItemForm: {},
			unpaid: {},
			cancel: {},
			payOnsite: {},
			rescheduleItem: {},
		},
	},
}))
// The interceptor and the services all reach the database; these tests only
// check the controller's permission metadata and what it passes on.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./bookings.service", () => ({
	BookingService: jest.fn(),
}))
jest.mock("@/modules/v1/policies/policy-documents.service", () => ({
	PolicyDocumentService: jest.fn(),
}))
jest.mock("@/modules/v1/forms/form-uploads.service", () => ({ FormUploadService: jest.fn() }))
jest.mock("@/modules/v1/forms/form-submissions.service", () => ({
	FormSubmissionService: jest.fn(),
}))

function permissions(handler: unknown): unknown {
	return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler as object)
}

describe("BookingsController permissions", () => {
	// RbacGuard reads this metadata: 403 plus a denied audit entry without the
	// key, 401 without a session (rbac.guard.spec.ts).
	it("requires bookings.own:create to book", () => {
		expect(permissions(BookingsController.prototype.create)).toEqual(["bookings.own:create"])
	})

	it("requires bookings.own:create to read the policies and the questionnaire (ADM-9, FRM-2)", () => {
		expect(permissions(BookingsController.prototype.policies)).toEqual(["bookings.own:create"])
		expect(permissions(BookingsController.prototype.form)).toEqual(["bookings.own:create"])
		expect(permissions(BookingsController.prototype.uploadFormFile)).toEqual([
			"bookings.own:create",
		])
		expect(permissions(BookingsController.prototype.updateItemForm)).toEqual([
			"bookings.own:create",
		])
	})

	it("requires bookings.own:read to see the booking awaiting payment (BKG-2)", () => {
		expect(permissions(BookingsController.prototype.unpaid)).toEqual(["bookings.own:read"])
	})

	it("requires bookings.own:read to list and open own bookings (BKG-4)", () => {
		expect(permissions(BookingsController.prototype.listOwn)).toEqual(["bookings.own:read"])
		expect(permissions(BookingsController.prototype.getOwn)).toEqual(["bookings.own:read"])
	})


	it("requires bookings.own:cancel to cancel (BKG-2)", () => {
		expect(permissions(BookingsController.prototype.cancel)).toEqual(["bookings.own:cancel"])
	})

	it("requires payments.own:create to choose paying at the office (BKG-2)", () => {
		expect(permissions(BookingsController.prototype.payOnsite)).toEqual(["payments.own:create"])
	})

	it("requires bookings.own:reschedule to reschedule a booked item (BKG-5)", () => {
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				BookingsController.prototype.rescheduleItem
			)
		).toEqual(["bookings.own:reschedule"])
	})
})

describe("BookingsController own bookings (BKG-4)", () => {
	function controllerWith(service: Partial<BookingService>) {
		return new BookingsController(service as BookingService, {} as never, {} as never, {} as never)
	}

	it("passes the caller's id to listOwn and getOwn", async () => {
		const listOwn = jest.fn().mockResolvedValue({ bookings: [] })
		const getOwn = jest.fn().mockResolvedValue({ id: 31 })
		const controller = controllerWith({ listOwn, getOwn })
		const session = { user: { id: "client-1" } } as never

		const list = (await controller.listOwn(session)) as unknown as (ctx: {
			input: unknown
		}) => Promise<unknown>
		await expect(list({ input: undefined })).resolves.toEqual({ bookings: [] })
		expect(listOwn).toHaveBeenCalledWith("client-1")

		const get = (await controller.getOwn(session)) as unknown as (ctx: {
			input: { bookingId: number }
		}) => Promise<unknown>
		await expect(get({ input: { bookingId: 31 } })).resolves.toEqual({ id: 31 })
		expect(getOwn).toHaveBeenCalledWith(31, "client-1")
	})

	it("passes a null caller when there is no session, so the service answers 401", async () => {
		const listOwn = jest.fn().mockRejectedValue(new Error("UNAUTHORIZED"))
		const controller = controllerWith({ listOwn })

		const list = (await controller.listOwn(undefined)) as unknown as (ctx: {
			input: unknown
		}) => Promise<unknown>
		await expect(list({ input: undefined })).rejects.toThrow("UNAUTHORIZED")
		expect(listOwn).toHaveBeenCalledWith(null)
	})
})

jest.mock("@/modules/v1/forms/form-submissions.service", () => ({
	FormSubmissionService: jest.fn(),
}))
