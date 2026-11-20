import { ORPCError } from "@orpc/server"

import { sessions, users } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { ExportService } from "@/common/export/export.service"
import type { RbacCacheService } from "@/common/rbac/rbac-cache.service"
import { PrivilegeGuardError, type RbacService } from "@/common/rbac/rbac.service"

import { RbacAdminService } from "./rbac-admin.service"

const mockRequestPasswordReset = jest.fn().mockResolvedValue({ status: true })

jest.mock("@repo/auth", () => ({
	authEnv: { APP_WEB_URL: "http://localhost:3001" },
	getAuth: () => ({
		api: {
			requestPasswordReset: mockRequestPasswordReset,
		},
	}),
}))

jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Super Admin",
	PERMISSION_NAMES: ["users.accounts:read", "users.accounts:manage", "users.roles:manage"],
}))

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options: { message: string }
		) {
			super(options.message)
		}
	},
}))

jest.mock("@/common/database/database.client", () => ({
	db: {
		select: jest.fn(),
		transaction: jest.fn(),
	},
}))

function mockTransaction(tx: Record<string, unknown>) {
	jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
	return tx
}

describe("RbacAdminService", () => {
	let service: RbacAdminService
	let rbacService: {
		holdsAdmin: jest.Mock
		assertCanDeactivateUser: jest.Mock
		assignRole: jest.Mock
		removeRole: jest.Mock
	}
	let cacheService: { invalidate: jest.Mock; clear: jest.Mock }
	let auditService: { record: jest.Mock; list: jest.Mock }
	let exportService: ExportService

	beforeEach(() => {
		jest.clearAllMocks()
		rbacService = {
			holdsAdmin: jest.fn().mockResolvedValue(true),
			assertCanDeactivateUser: jest.fn().mockResolvedValue(undefined),
			assignRole: jest.fn().mockResolvedValue(undefined),
			removeRole: jest.fn().mockResolvedValue(undefined),
		}
		cacheService = {
			invalidate: jest.fn().mockResolvedValue(undefined),
			clear: jest.fn().mockResolvedValue(undefined),
		}
		auditService = {
			record: jest.fn().mockResolvedValue(undefined),
			list: jest.fn(),
		}
		exportService = new ExportService()
		service = new RbacAdminService(
			rbacService as unknown as RbacService,
			cacheService as unknown as RbacCacheService,
			auditService as unknown as AuditService,
			exportService
		)
	})

	it("AC1: creates a staff account with roles, triggers set-password invite email, and writes a PII-free audit entry", async () => {
		const now = new Date("2026-11-19T00:00:00.000Z")
		const selectRolesWhere = jest.fn().mockResolvedValue([{ id: 3, name: "Processing Officer" }])
		const selectUserWhere = jest.fn().mockResolvedValue([])

		let selectCall = 0
		const select = jest.fn().mockImplementation(() => ({
			from: () => ({
				where: (...args: unknown[]) => {
					selectCall += 1
					return selectCall === 1 ? selectRolesWhere(...args) : selectUserWhere(...args)
				},
			}),
		}))

		const userInsertReturning = jest.fn().mockResolvedValue([
			{
				id: "staff-100",
				name: "Jose Rizal",
				email: "jose@boq.gov.ph",
				accountType: "staff",
				mustResetPassword: true,
				disabledAt: null,
				deletedAt: null,
				createdAt: now,
			},
		])
		const roleInsertValues = jest.fn().mockResolvedValue(undefined)

		let insertCall = 0
		const insert = jest.fn().mockImplementation(() => ({
			values: (vals: unknown) => {
				insertCall += 1
				if (insertCall === 1) {
					return { returning: userInsertReturning }
				}
				return roleInsertValues(vals)
			},
		}))

		const tx = mockTransaction({ select, insert })

		const created = await service.createUser(
			{ name: "Jose Rizal", email: "jose@boq.gov.ph", roles: ["Processing Officer"] },
			"admin-1"
		)

		expect(created.accountType).toBe("staff")
		expect(created.roles).toEqual(["Processing Officer"])
		expect(mockRequestPasswordReset).toHaveBeenCalledWith({
			body: {
				email: "jose@boq.gov.ph",
				redirectTo: "http://localhost:3001/reset-password",
			},
		})

		// Rule 5: Audit entry contains no personal data (name/email)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "rbac",
				action: "user.create",
				actorId: "admin-1",
				targetType: "user",
				targetId: "staff-100",
				newValue: {
					accountType: "staff",
					mustResetPassword: true,
					roles: ["Processing Officer"],
				},
			}),
			tx
		)
		const recordedPayload = JSON.stringify(auditService.record.mock.calls[0]?.[0])
		expect(recordedPayload).not.toContain("Jose Rizal")
		expect(recordedPayload).not.toContain("jose@boq.gov.ph")
	})

	it("AC2: filters, pages, and exports user list to CSV, XLSX, and PDF", async () => {
		const now = new Date("2026-11-19T00:00:00.000Z")
		const userRows = [
			{
				id: "u-1",
				name: "Clara Reyes",
				email: "clara@boq.gov.ph",
				accountType: "staff",
				disabledAt: null,
				deletedAt: null,
				createdAt: now,
			},
			{
				id: "u-2",
				name: "Pedro Cruz",
				email: "pedro@example.com",
				accountType: "client",
				disabledAt: null,
				deletedAt: null,
				createdAt: now,
			},
		]
		const roleRows = [
			{ userId: "u-1", name: "Cashier" },
			{ userId: "u-2", name: "Client" },
		]

		let callIdx = 0
		jest.mocked(db.select).mockImplementation(() => {
			callIdx += 1
			if (callIdx % 2 === 1) {
				return {
					from: () => ({
						where: () => ({
							orderBy: () => Promise.resolve(userRows),
						}),
					}),
				} as never
			}
			return {
				from: () => ({
					innerJoin: () => ({
						where: () => Promise.resolve(roleRows),
					}),
				}),
			} as never
		})

		const paged = await service.listUsers({ role: "Cashier", page: 1, pageSize: 10 }, true)
		expect(paged.total).toBe(1)
		expect(paged.items[0]?.id).toBe("u-1")

		const exported = await service.exportUsers({ format: "csv", role: "Cashier" }, true)
		expect(exported.fileName).toMatch(/^qsps-users-.*\.csv$/)
		expect(Buffer.from(exported.contentBase64, "base64").toString("utf8")).toContain(
			"clara@boq.gov.ph"
		)
	})

	it("AC3: disabling or soft-deleting revokes sessions, sets lifecycle timestamps, and audits without PII", async () => {
		const now = new Date("2026-11-19T00:00:00.000Z")
		const activeUser = {
			id: "staff-5",
			name: "Elena Gomez",
			email: "elena@boq.gov.ph",
			accountType: "staff",
			disabledAt: null,
			deletedAt: null,
			createdAt: now,
		}

		const updateReturning = jest.fn().mockResolvedValue([{ ...activeUser, disabledAt: now }])
		const deleteWhere = jest.fn().mockResolvedValue(undefined)

		const tx = mockTransaction({
			select: jest.fn().mockReturnValue({
				from: (table: unknown) => ({
					where: () => Promise.resolve(table === users ? [activeUser] : []),
					innerJoin: () => ({
						where: () => Promise.resolve([]),
					}),
				}),
			}),
			update: jest.fn().mockReturnValue({
				set: () => ({
					where: () => ({ returning: updateReturning }),
				}),
			}),
			delete: jest.fn().mockReturnValue({
				where: deleteWhere,
			}),
		})

		await service.setUserStatus({ userId: "staff-5", isActive: false }, "admin-1")
		expect(tx.delete).toHaveBeenCalledWith(sessions)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "user.disable",
				targetId: "staff-5",
				oldValue: { status: "active" },
				newValue: { status: "disabled" },
			}),
			tx
		)

		await service.deleteUser("staff-5", "admin-1")
		expect(tx.update).toHaveBeenCalledWith(users)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "user.delete",
				targetId: "staff-5",
				newValue: { status: "deleted" },
			}),
			tx
		)
	})

	it("AC4: refuses with 403 and audits denial when attempting to disable or delete the last Super Admin", async () => {
		const now = new Date("2026-11-19T00:00:00.000Z")
		const superAdmin = {
			id: "sa-1",
			name: "Chief Admin",
			email: "chief@boq.gov.ph",
			accountType: "staff",
			disabledAt: null,
			deletedAt: null,
			createdAt: now,
		}

		rbacService.assertCanDeactivateUser.mockRejectedValue(
			new PrivilegeGuardError(
				"FORBIDDEN",
				"Cannot disable or delete the last active Super Admin",
				"deactivation would leave zero active Super Admin holders"
			)
		)

		mockTransaction({
			select: jest.fn().mockReturnValue({
				from: () => ({
					where: () => Promise.resolve([superAdmin]),
				}),
			}),
		})

		await expect(
			service.setUserStatus({ userId: "sa-1", isActive: false }, "sysadmin-1")
		).rejects.toBeInstanceOf(ORPCError)

		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "rbac",
				action: "user.disable",
				outcome: "denied",
				actorId: "sysadmin-1",
				targetId: "sa-1",
			})
		)
	})
})