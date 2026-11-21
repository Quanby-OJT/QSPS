import type { RbacService } from "@/common/rbac/rbac.service"
import type { ResolvedScope } from "@/common/scope/scope-match"
import { REQUIRED_PERMISSIONS_KEY } from "@/shared/decorators/require-permissions.decorator"

import type { RbacAdminService } from "./rbac-admin.service"
import { RbacController } from "./rbac.controller"

jest.mock("@orpc/nest", () => ({
	Implement: () => () => undefined,
}))

let handlerInput: unknown

jest.mock("@orpc/server", () => ({
	implement: jest.fn(() => ({
		handler: jest.fn((fn: (options: { input: unknown }) => unknown) => fn({ input: handlerInput })),
	})),
}))

jest.mock("@/config/api-versions.config", () => ({
	v1: {
		rbac: {
			roles: { list: {}, create: {}, update: {}, setPermissions: {}, delete: {} },
			permissions: { list: {} },
			users: {
				list: {},
				export: {},
				create: {},
				update: {},
				setStatus: {},
				delete: {},
				assignRole: {},
				removeRole: {},
				getScopes: {},
				setScopes: {},
			},
			audit: { list: {} },
		},
	},
}))

jest.mock("@thallesp/nestjs-better-auth", () => ({
	Session: () => () => undefined,
}))

jest.mock("@/shared/interceptors/idempotency.interceptor", () => ({
	IdempotencyInterceptor: class IdempotencyInterceptor {},
}))

jest.mock("@/common/rbac/rbac.service", () => ({
	RbacService: jest.fn(),
}))

jest.mock("./rbac-admin.service", () => ({
	RbacAdminService: jest.fn(),
}))

/** ADM-2: the Scope the resolver hands back for the signed-in user. */
const SCOPE: ResolvedScope = {
	nationwide: false,
	entries: [{ serviceCategoryId: 1, locationId: 10 }],
}

function requiredPermissions(handler: keyof RbacController): unknown {
	return Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, RbacController.prototype[handler])
}

describe("RbacController", () => {
	let controller: RbacController
	let adminService: Record<string, jest.Mock>
	let rbacService: { hasPermission: jest.Mock }

	beforeEach(() => {
		handlerInput = undefined
		adminService = {
			listRoles: jest.fn(),
			createRole: jest.fn(),
			updateRole: jest.fn(),
			setRolePermissions: jest.fn(),
			deleteRole: jest.fn(),
			listPermissions: jest.fn(),
			listUsers: jest.fn(),
			exportUsers: jest.fn(),
			createUser: jest.fn(),
			updateUser: jest.fn(),
			setUserStatus: jest.fn(),
			deleteUser: jest.fn(),
			assignUserRole: jest.fn(),
			removeUserRole: jest.fn(),
			getUserScopes: jest.fn(),
			setUserScopes: jest.fn(),
			listAuditLog: jest.fn(),
		}
		rbacService = {
			hasPermission: jest.fn().mockResolvedValue(true),
		}
		controller = new RbacController(
			adminService as unknown as RbacAdminService,
			rbacService as unknown as RbacService,
			{ resolve: jest.fn().mockResolvedValue(SCOPE) }
		)
	})

	it.each(["listUsers", "exportUsers"] as const)("requires users.accounts:read on %s", handler => {
		expect(requiredPermissions(handler)).toEqual(["users.accounts:read"])
	})

	it.each(["createUser", "updateUser", "setUserStatus", "deleteUser"] as const)(
		"requires users.accounts:manage on %s",
		handler => {
			expect(requiredPermissions(handler)).toEqual(["users.accounts:manage"])
		}
	)

	// ADM-2 acceptance 4: without users.scopes:manage the guard answers 403 and audits it.
	it.each(["getUserScopes", "setUserScopes"] as const)(
		"requires users.scopes:manage on %s",
		handler => {
			expect(requiredPermissions(handler)).toEqual(["users.scopes:manage"])
		}
	)

	it("passes the caller's Scope to the scope endpoints", async () => {
		handlerInput = { userId: "u-2" }
		await controller.getUserScopes({ user: { id: "sysadmin-1" } } as never)
		expect(adminService.getUserScopes).toHaveBeenCalledWith("u-2", "sysadmin-1", SCOPE)

		handlerInput = { userId: "u-2", scopes: [{ serviceCategoryId: 1, locationId: 10 }] }
		await controller.setUserScopes({ user: { id: "sysadmin-1" } } as never)
		expect(adminService.setUserScopes).toHaveBeenCalledWith(handlerInput, "sysadmin-1", SCOPE)
	})

	it.each(["assignRole", "removeRole"] as const)("requires users.roles:manage on %s", handler => {
		expect(requiredPermissions(handler)).toEqual(["users.roles:manage"])
	})

	it("requires audit.logs:read on listAuditLog", () => {
		expect(requiredPermissions("listAuditLog")).toEqual(["audit.logs:read"])
	})

	it("passes includeDirectory=false on listUsers and exportUsers when caller lacks users.accounts:manage", async () => {
		rbacService.hasPermission.mockResolvedValue(false)
		handlerInput = { page: 1, pageSize: 20 }
		await controller.listUsers({ user: { id: "auditor-1" } } as never)
		expect(adminService.listUsers).toHaveBeenCalledWith(handlerInput, false, SCOPE)

		handlerInput = { format: "csv" }
		await controller.exportUsers({ user: { id: "auditor-1" } } as never)
		expect(adminService.exportUsers).toHaveBeenCalledWith(handlerInput, false, "auditor-1", SCOPE)
	})

	it("attributes staff user creation, updates, status changes, and soft-deletes to the actor", async () => {
		handlerInput = { name: "Ana Reyes", email: "ana@boq.gov.ph", roles: ["Cashier"] }
		await controller.createUser({ user: { id: "admin-1" } } as never)
		expect(adminService.createUser).toHaveBeenCalledWith(handlerInput, "admin-1", SCOPE)

		handlerInput = { userId: "u-2", name: "Ana M. Reyes" }
		await controller.updateUser({ user: { id: "admin-1" } } as never)
		expect(adminService.updateUser).toHaveBeenCalledWith(handlerInput, "admin-1", SCOPE)

		handlerInput = { userId: "u-2", isActive: false }
		await controller.setUserStatus({ user: { id: "admin-1" } } as never)
		expect(adminService.setUserStatus).toHaveBeenCalledWith(handlerInput, "admin-1", SCOPE)

		handlerInput = { userId: "u-2" }
		await controller.deleteUser({ user: { id: "admin-1" } } as never)
		expect(adminService.deleteUser).toHaveBeenCalledWith("u-2", "admin-1", SCOPE)
	})
})
