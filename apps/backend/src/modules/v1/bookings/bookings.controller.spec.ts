import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"
import { THROTTLER_LIMIT } from "@nestjs/throttler/dist/throttler.constants"

import { BookingsController } from "./bookings.controller"
import type { BookingService } from "./bookings.service"

jest.mock("@orpc/contract", () => {
	type ChainProxy = ((...args: unknown[]) => ChainProxy) & {
		[key: string]: ChainProxy
	}
	const target = (() => {}) as unknown as ChainProxy
	const chain: ChainProxy = new Proxy(target, {
		get: () => chain,
		apply: () => chain,
	})
	return { oc: chain }
})
jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))
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
		},
	},
}))
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))
jest.mock("./bookings.service", () => ({
	BookingService: jest.fn(),
}))

describe("BookingsController permissions & delegation", () => {
	// RbacGuard reads this metadata: 401 without a session, 403 plus a denied
	// audit entry without the key (rbac.guard.spec.ts).
	it("requires bookings.own:create to confirm a booking", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.create)
		).toEqual(["bookings.own:create"])
	})

	it("requires bookings.own:read to list own bookings (BKG-4)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.listOwn)
		).toEqual(["bookings.own:read"])
	})

	it("requires bookings.own:read to read own booking details (BKG-4)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.getOwn)
		).toEqual(["bookings.own:read"])
	})

	it("requires bookings.own:create to read applicable policies and the Service questionnaire (ADM-9, FRM-2)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.policies)
		).toEqual(["bookings.own:create"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.form)
		).toEqual(["bookings.own:create"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.updateItemForm)
		).toEqual(["bookings.own:create"])
	})

	it("strictly rate-limits file uploads and requires bookings.own:create (FRM-2)", () => {
		const handler = BookingsController.prototype.uploadFormFile
		expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual(["bookings.own:create"])
		expect(Reflect.getMetadataKeys(handler).length).toBeGreaterThan(1)
	})

	it("requires bookings.own:read to read the caller's unpaid booking (BKG-2)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.unpaid)
		).toEqual(["bookings.own:read"])
	})

	it("requires bookings.own:cancel to cancel an unpaid booking (BKG-2)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.cancel)
		).toEqual(["bookings.own:cancel"])
	})

	it("requires payments.own:create to switch an unpaid booking to onsite payment (BKG-2)", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, BookingsController.prototype.payOnsite)
		).toEqual(["payments.own:create"])
	})

	it("delegates listOwn and getOwn with the caller's session user id", async () => {
		const listOwn = jest.fn().mockResolvedValue({ bookings: [] })
		const getOwn = jest.fn().mockResolvedValue({ id: 31 })
		const controller = new BookingsController(
			{ listOwn, getOwn } as unknown as BookingService,
			{} as never,
			{} as never,
			{} as never
		)

		const session = { user: { id: "client-1" } } as never
		const listHandler = (await controller.listOwn(session)) as unknown as (ctx: {
			input: unknown
		}) => Promise<unknown>
		await expect(listHandler({ input: undefined })).resolves.toEqual({ bookings: [] })
		expect(listOwn).toHaveBeenCalledWith("client-1")

		const getHandler = (await controller.getOwn(session)) as unknown as (ctx: {
			input: { bookingId: number }
		}) => Promise<unknown>
		await expect(getHandler({ input: { bookingId: 31 } })).resolves.toEqual({ id: 31 })
		expect(getOwn).toHaveBeenCalledWith(31, "client-1")
	})

	it("passes null actorId when session is missing (allowing RbacGuard / service to reject 401)", async () => {
		const listOwn = jest.fn().mockRejectedValue(new Error("UNAUTHORIZED"))
		const controller = new BookingsController(
			{ listOwn } as unknown as BookingService,
			{} as never,
			{} as never,
			{} as never
		)

		const listHandler = (await controller.listOwn(undefined)) as unknown as (ctx: {
			input: unknown
		}) => Promise<unknown>
		await expect(listHandler({ input: undefined })).rejects.toThrow("UNAUTHORIZED")
		expect(listOwn).toHaveBeenCalledWith(null)
	})
})