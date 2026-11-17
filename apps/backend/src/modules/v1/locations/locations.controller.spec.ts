import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { LocationsController } from "./locations.controller"
import type { LocationsService } from "./locations.service"

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
		locations: {
			list: {},
			listAvailable: {},
			create: {},
			update: {},
			setActive: {},
			delete: {},
		},
	},
}))

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))

// The interceptor and the service both reach the database; these tests only
// check the controller's permission metadata and wiring.
jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))

jest.mock("./locations.service", () => ({
	LocationsService: jest.fn(),
}))

const MANAGE_KEY = "settings.locations:manage"

function requiredPermissions(handler: keyof LocationsController): unknown {
	return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, LocationsController.prototype[handler])
}

describe("LocationsController", () => {
	let controller: LocationsController
	let service: {
		list: jest.Mock
		listAvailable: jest.Mock
		create: jest.Mock
		update: jest.Mock
		setActive: jest.Mock
		delete: jest.Mock
	}

	beforeEach(() => {
		handlerInput = undefined
		service = {
			list: jest.fn(),
			listAvailable: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			setActive: jest.fn(),
			delete: jest.fn(),
		}
		controller = new LocationsController(service as unknown as LocationsService)
	})

	// RbacGuard reads this metadata and answers 403 plus a denied Audit Entry
	// when the caller lacks the key (Flow A). A write route without it would be
	// open to every signed-in user, so each one is pinned here.
	it.each(["create", "update", "setActive", "delete"] as const)(
		"requires settings.locations:manage on %s",
		handler => {
			expect(requiredPermissions(handler)).toEqual([MANAGE_KEY])
		}
	)

	it("requires settings.locations:manage to list every location, disabled ones included", () => {
		expect(requiredPermissions("list")).toEqual([MANAGE_KEY])
	})

	// DOMAIN-MODEL section 2: reading locations needs only a signed-in session.
	it("leaves the active-location list open to any signed-in user", () => {
		expect(requiredPermissions("listAvailable")).toBeUndefined()
	})

	it("attributes a create to the signed-in user", async () => {
		handlerInput = { code: "MNL", name: "Manila", address: "Port Area, Manila", region: "NCR" }
		service.create.mockResolvedValue({ code: "MNL" })

		await expect(controller.create({ user: { id: "staff-1" } } as never)).resolves.toEqual({
			code: "MNL",
		})
		expect(service.create).toHaveBeenCalledWith(handlerInput, "staff-1")
	})

	it("attributes an update and a status change to the signed-in user", async () => {
		handlerInput = { code: "MNL", name: "Manila Main" }
		await controller.update({ user: { id: "staff-1" } } as never)
		expect(service.update).toHaveBeenCalledWith(handlerInput, "staff-1")

		handlerInput = { code: "MNL", isActive: false }
		await controller.setActive({ user: { id: "staff-1" } } as never)
		expect(service.setActive).toHaveBeenCalledWith(handlerInput, "staff-1")
	})

	it("passes only the code to delete", async () => {
		handlerInput = { code: "MNL" }
		await controller.delete({ user: { id: "staff-1" } } as never)
		expect(service.delete).toHaveBeenCalledWith("MNL", "staff-1")
	})
})