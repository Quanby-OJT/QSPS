import { UnauthorizedException } from "@nestjs/common"
import { Test, type TestingModule } from "@nestjs/testing"

import { RbacService } from "@/common/rbac/rbac.service"

import { MeController } from "./me.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Super Admin",
	PERMISSION_NAMES: [
		"bookings.own:read",
		"bookings.own:create",
		"bookings.own:reschedule",
		"bookings.own:cancel",
		"bookings.own:*",
		"users.accounts:read",
		"users.roles:manage",
	],
	ROLE_NAMES: ["Super Admin", "System Admin", "Client"],
}))

jest.mock("@/common/rbac/rbac.service", () => ({
	RbacService: jest.fn(),
}))

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: jest.fn((fn: () => unknown) => fn()),
	})),
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: {
		me: {
			permissions: {},
		},
	},
}))

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))

describe("MeController", () => {
	let controller: MeController
	let rbacService: { getUserAccess: jest.Mock }

	beforeEach(async () => {
		rbacService = {
			getUserAccess: jest.fn(),
		}

		const module: TestingModule = await Test.createTestingModule({
			controllers: [MeController],
			providers: [{ provide: RbacService, useValue: rbacService }],
		}).compile()

		controller = module.get(MeController)
	})

	it("returns the current user's roles and permissions", async () => {
		rbacService.getUserAccess.mockResolvedValue({
			roles: ["Client"],
			permissions: ["bookings.own:read"],
		})

		await expect(controller.getPermissions({ user: { id: "user-1" } } as never)).resolves.toEqual({
			roles: ["Client"],
			permissions: ["bookings.own:read"],
		})
		expect(rbacService.getUserAccess).toHaveBeenCalledWith("user-1")
	})

	it("throws UnauthorizedException if the session is missing", async () => {
		await expect(controller.getPermissions(undefined)).rejects.toBeInstanceOf(UnauthorizedException)
		expect(rbacService.getUserAccess).not.toHaveBeenCalled()
	})
})
