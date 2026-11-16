import { RbacService } from "./rbac.service"

// `RbacService` refuses with `ORPCError` so oRPC maps denials to real statuses
// rather than a 500. `@orpc/server` is ESM and this jest config does not
// transform it, so it is stubbed here as it is in the other RBAC specs.
jest.mock("@orpc/server", () => ({
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

jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Super Admin",
	PERMISSION_NAMES: [
		"bookings.own:read",
		"bookings.own:create",
		"bookings.own:reschedule",
		"bookings.own:cancel",
		"bookings.own:*",
		"bookings.all:read",
		"users.accounts:read",
		"users.roles:manage",
	],
}))

jest.mock("@repo/db/schema", () => ({
	permissions: { id: "permissionId", name: "permissionName" },
	rolePermissions: { roleId: "roleId", permissionId: "permissionId" },
	roles: { id: "roleId", name: "roleName" },
	userRoles: { userId: "userId", roleId: "roleId" },
	users: { id: "userId" },
}))

jest.mock("@/common/database/database.client", () => ({
	db: {
		select: jest.fn(),
		insert: jest.fn(),
		delete: jest.fn(),
	},
}))

/** A service whose cache already holds this user's resolved roles and grants. */
function serviceFor(roleNames: string[], permissionNames: string[]) {
	const cacheService = {
		get: jest.fn(() => ({
			roleNames: new Set(roleNames),
			permissionNames: new Set(permissionNames),
		})),
		set: jest.fn(),
		invalidate: jest.fn(),
	}
	const auditService = { record: jest.fn(), list: jest.fn() }
	const service = new RbacService(cacheService as never, auditService as never)
	return { service, cacheService, auditService }
}

describe("RbacService", () => {
	it("returns all resolved roles and catalog-ordered permissions from the cached resolved set", async () => {
		// RbacService also writes audit entries inside grant/removal transactions.
		// This test only exercises the read path, so the collaborator is a stub;
		// the in-transaction behaviour is covered in audit.service.spec.
		const { service, cacheService } = serviceFor(
			["Client", "Super Admin", "Owner"],
			["users.accounts:read", "bookings.own:read", "bookings.own:*", "billing:read"]
		)

		await expect(service.getUserAccess("user-1")).resolves.toEqual({
			roles: ["Client", "Owner", "Super Admin"],
			permissions: ["bookings.own:read", "bookings.own:*", "users.accounts:read"],
		})
		expect(cacheService.get).toHaveBeenCalledWith("user-1")
		expect(cacheService.set).not.toHaveBeenCalled()
	})

	// FND-2 acceptance: a role holding bookings.own:* passes a route that
	// requires bookings.own:create (dotted resource + wildcard).
	it("lets a bookings.own:* holder through bookings.own:create, and only that resource", async () => {
		const { service } = serviceFor(["Client"], ["bookings.own:*"])

		await expect(service.hasPermission("u1", "bookings.own:create")).resolves.toBe(true)
		await expect(service.hasPermission("u1", "bookings.own:cancel")).resolves.toBe(true)
		await expect(service.hasPermission("u1", "bookings.all:read")).resolves.toBe(false)
	})

	// FND-2 acceptance: a key that is not in the catalog is denied for everyone
	// except Super Admin, even when a role row happens to hold it.
	it("denies a non-catalog key to everyone except Super Admin", async () => {
		const client = serviceFor(["Client"], ["billing:read"])
		await expect(client.service.hasPermission("u1", "billing:read")).resolves.toBe(false)

		const superAdmin = serviceFor(["Super Admin"], [])
		await expect(superAdmin.service.hasPermission("u2", "billing:read")).resolves.toBe(true)
	})

	// FND-2 acceptance: a 403 writes an audit entry with outcome denied, the key,
	// and the actor.
	it("records a permission denial as a denied audit entry with the actor and the keys", async () => {
		const { service, auditService } = serviceFor([], [])

		await service.recordPermissionDenial({
			actorId: "u1",
			route: "RbacController.listRoles",
			requiredPermissions: ["users.roles:manage"],
			missingPermissions: ["users.roles:manage"],
		})

		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "rbac",
				action: "permission.check",
				outcome: "denied",
				actorId: "u1",
				targetType: "route",
				targetId: "RbacController.listRoles",
				newValue: {
					requiredPermissions: ["users.roles:manage"],
					missingPermissions: ["users.roles:manage"],
				},
			})
		)
	})
})
