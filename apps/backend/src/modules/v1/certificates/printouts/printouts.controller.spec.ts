import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { PrintoutsController } from "./printouts.controller"
import type { PrintoutService } from "./printouts.service"

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))
jest.mock("./printouts.service", () => ({
	PrintoutService: jest.fn(),
}))

const rendered = { fileName: "form.pdf", pdf: Buffer.from("%PDF-1.3") }

function fakeResponse() {
	return { setHeader: jest.fn(), end: jest.fn() }
}

describe("Printouts permissions (CRT-4)", () => {
	it("requires bookings.own:read for the client's download", () => {
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				PrintoutsController.prototype.downloadApplicationForm
			)
		).toEqual(["bookings.own:read"])
	})

	it("requires bookings.own:read to list a booking's application forms", () => {
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				PrintoutsController.prototype.listApplicationForms
			)
		).toEqual(["bookings.own:read"])
	})

	it("requires certificates.documents:print for both staff prints", () => {
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				PrintoutsController.prototype.printApplicationForm
			)
		).toEqual(["certificates.documents:print"])
		expect(
			Reflect.getMetadata(
				REQUIRED_PERMISSIONS_KEY,
				PrintoutsController.prototype.printRequestForPayment
			)
		).toEqual(["certificates.documents:print"])
	})
})

describe("PrintoutsController", () => {
	it("sends the client's own form inline and uncached", async () => {
		const applicationFormForOwner = jest.fn().mockResolvedValue(rendered)
		const controller = new PrintoutsController({
			applicationFormForOwner,
		} as unknown as PrintoutService)
		const response = fakeResponse()

		await controller.downloadApplicationForm(
			44,
			response as never,
			{
				user: { id: "client-1" },
			} as never
		)

		expect(applicationFormForOwner).toHaveBeenCalledWith(44, "client-1")
		expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store")
		expect(response.setHeader).toHaveBeenCalledWith(
			"Content-Disposition",
			'inline; filename="form.pdf"'
		)
		expect(response.end).toHaveBeenCalledWith(Buffer.from("%PDF-1.3"))
	})

	it("lists the client's own application forms", async () => {
		const applicationFormsForOwner = jest
			.fn()
			.mockResolvedValue([{ bookingItemId: 44, serviceName: "Physical Examination" }])
		const controller = new PrintoutsController({
			applicationFormsForOwner,
		} as unknown as PrintoutService)

		const result = await controller.listApplicationForms(31, { user: { id: "client-1" } } as never)

		expect(applicationFormsForOwner).toHaveBeenCalledWith(31, "client-1")
		expect(result).toEqual({
			items: [{ bookingItemId: 44, serviceName: "Physical Examination" }],
		})
	})

	it("prints the application form in the caller's Scope", async () => {
		const applicationFormForStaff = jest.fn().mockResolvedValue(rendered)
		const scope = { nationwide: false, entries: [{ serviceCategoryId: 3, locationId: 2 }] }
		const resolver = { resolve: jest.fn().mockResolvedValue(scope) }
		const controller = new PrintoutsController(
			{ applicationFormForStaff } as unknown as PrintoutService,
			resolver
		)
		const response = fakeResponse()

		await controller.printApplicationForm(
			44,
			response as never,
			{
				user: { id: "staff-1" },
			} as never
		)

		expect(resolver.resolve).toHaveBeenCalledWith("staff-1")
		expect(applicationFormForStaff).toHaveBeenCalledWith(44, "staff-1", scope)
		expect(response.end).toHaveBeenCalledWith(Buffer.from("%PDF-1.3"))
	})

	it("prints the Request for Payment in the caller's Scope", async () => {
		const requestForPaymentForStaff = jest.fn().mockResolvedValue(rendered)
		const scope = { nationwide: true, entries: [] }
		const resolver = { resolve: jest.fn().mockResolvedValue(scope) }
		const controller = new PrintoutsController(
			{ requestForPaymentForStaff } as unknown as PrintoutService,
			resolver
		)

		await controller.printRequestForPayment(
			31,
			fakeResponse() as never,
			{
				user: { id: "cashier-1" },
			} as never
		)

		expect(requestForPaymentForStaff).toHaveBeenCalledWith(31, "cashier-1", scope)
	})

	it("prints with no Scope when none is wired in, so it fails closed", async () => {
		const applicationFormForStaff = jest.fn().mockResolvedValue(rendered)
		const controller = new PrintoutsController({
			applicationFormForStaff,
		} as unknown as PrintoutService)

		await controller.printApplicationForm(
			44,
			fakeResponse() as never,
			{
				user: { id: "staff-1" },
			} as never
		)

		expect(applicationFormForStaff).toHaveBeenCalledWith(44, "staff-1", {
			nationwide: false,
			entries: [],
		})
	})
})
