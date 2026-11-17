import "reflect-metadata"

import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { ServicesController } from "./services.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

jest.mock("@orpc/server", () => ({
	implement: () => ({ handler: jest.fn() }),
}))

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: {
		services: {
			listCategories: {},
			list: {},
			listAvailable: {},
			create: {},
			update: {},
			setActive: {},
		},
	},
}))

describe("ServicesController permissions", () => {
	it.each(["create", "update", "setActive"] as const)(
		"requires service-management permission on %s",
		method => {
			const handler = ServicesController.prototype[method]

			expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler)).toEqual([
				"settings.services:manage",
			])
		}
	)
})
