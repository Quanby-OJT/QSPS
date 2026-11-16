import { UnauthorizedException } from "@nestjs/common"
import { Test, type TestingModule } from "@nestjs/testing"

import { RbacService } from "@/common/rbac/rbac.service"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import { MeProfileService } from "./me-profile.service"
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
		"account.profile:manage",
	],
	ROLE_NAMES: ["Super Admin", "System Admin", "Client"],
}))

jest.mock("@/common/rbac/rbac.service", () => ({
	RbacService: jest.fn(),
}))

// The service talks to the database; the controller tests only check wiring.
jest.mock("./me-profile.service", () => ({
	MeProfileService: jest.fn(),
}))

/** What the next oRPC handler call receives as its `{ input }`. */
let handlerInput: unknown

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: jest.fn((fn: (options: { input: unknown }) => unknown) => fn({ input: handlerInput })),
	})),
	ORPCError: class ORPCError extends Error {
		constructor(
			public code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: {
		me: {
			permissions: {},
			profile: {},
			updateProfile: {},
		},
	},
}))

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))

const completeProfile = {
	name: "Juan Dela Cruz",
	email: "juan@qsps.local",
	mobile: "09171234567",
	birthDate: "1995-06-15",
	nationality: "Filipino",
	gender: "Male",
	profileCompletedAt: new Date("2026-11-16T08:00:00Z"),
	isComplete: true,
}

describe("MeController", () => {
	let controller: MeController
	let rbacService: { getUserAccess: jest.Mock }
	let meProfileService: { getProfile: jest.Mock; updateProfile: jest.Mock }

	beforeEach(async () => {
		handlerInput = undefined
		rbacService = {
			getUserAccess: jest.fn(),
		}
		meProfileService = {
			getProfile: jest.fn(),
			updateProfile: jest.fn(),
		}

		const module: TestingModule = await Test.createTestingModule({
			controllers: [MeController],
			providers: [
				{ provide: RbacService, useValue: rbacService },
				{ provide: MeProfileService, useValue: meProfileService },
			],
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

	it("returns the signed-in user's own profile", async () => {
		meProfileService.getProfile.mockResolvedValue(completeProfile)

		await expect(controller.getProfile({ user: { id: "user-1" } } as never)).resolves.toEqual(
			completeProfile
		)
		expect(meProfileService.getProfile).toHaveBeenCalledWith("user-1")
	})

	it("refuses the profile read with UNAUTHORIZED when there is no session", async () => {
		await expect(controller.getProfile(undefined)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		expect(meProfileService.getProfile).not.toHaveBeenCalled()
	})

	it("saves the profile for the signed-in user only", async () => {
		const input = {
			name: "Juan Dela Cruz",
			mobile: "09171234567",
			birthDate: "1995-06-15",
			nationality: "Filipino",
			gender: "Male",
		}
		handlerInput = input
		meProfileService.updateProfile.mockResolvedValue(completeProfile)

		await expect(controller.updateProfile({ user: { id: "user-1" } } as never)).resolves.toEqual(
			completeProfile
		)
		expect(meProfileService.updateProfile).toHaveBeenCalledWith("user-1", input)
	})

	// AUTH-1: "Enforces account.profile:manage on profile update". RbacGuard reads
	// this metadata; reading the profile needs only a session.
	it("requires account.profile:manage on the profile update, not on the read", () => {
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, MeController.prototype.updateProfile)
		).toEqual(["account.profile:manage"])
		expect(
			Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, MeController.prototype.getProfile)
		).toBeUndefined()
	})
})
