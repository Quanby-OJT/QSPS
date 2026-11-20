import { randomUUID } from "node:crypto"
import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"


import {
	ADMIN_ROLE,
	PERMISSION_NAMES,
	type AssignRoleRequest,
	type CreateRoleInput,
	type CreateStaffUserInput,
	type DeleteUserResponse,
	type ExportUsersRequest,
	type ExportUsersResponse,
	type ListAuditLogRequest,
	type ListAuditLogResponse,
	type ListUsersRequest,
	type ListUsersResponse,
	type PermissionCatalogEntry,
	type PermissionName,
	type RemoveRoleRequest,
	type Role,
	type SetRolePermissionsRequest,
	type SetUserStatusRequest,
	type UpdateRoleRequest,
	type UpdateUserRequest,
	type UserAccountStatus,
	type UserAccountType,
	type UserFilterQuerySchema,
	type UserWithRoles,
} from "@repo/contracts"
import { permissions, rolePermissions, roles, sessions, userRoles, users } from "@repo/db/schema"
import type { z } from "zod"

import { AUDIT_DOMAIN_RBAC, AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { ExportService } from "@/common/export/export.service"
import { RbacCacheService } from "@/common/rbac/rbac-cache.service"
import { PrivilegeGuardError, RbacService } from "@/common/rbac/rbac.service"

const PERMISSION_CATALOG = new Set<string>(PERMISSION_NAMES)

type UserFilterInput = z.infer<typeof UserFilterQuerySchema>

@Injectable()
export class RbacAdminService {
	constructor(
		private readonly rbacService: RbacService,
		private readonly cacheService: RbacCacheService,
		private readonly auditService: AuditService,
		private readonly exportService: ExportService
	) {}

	// ---------------------------------------------------------------- roles
	async listRoles(): Promise<Role[]> {
		const roleRows = await db.select().from(roles).orderBy(roles.name)

		const permRows = await db
			.select({ roleId: rolePermissions.roleId, name: permissions.name })
			.from(rolePermissions)
			.innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))

		const countRows = await db
			.select({ roleId: userRoles.roleId, count: sql<number>`count(*)::int` })
			.from(userRoles)
			.groupBy(userRoles.roleId)

		const permsByRole = new Map<number, PermissionName[]>()
		for (const row of permRows) {
			if (!PERMISSION_CATALOG.has(row.name)) continue
			const list = permsByRole.get(row.roleId) ?? []
			list.push(row.name as PermissionName)
			permsByRole.set(row.roleId, list)
		}

		const countByRole = new Map<number, number>()
		for (const row of countRows) {
			countByRole.set(row.roleId, row.count)
		}

		return roleRows.map(role => ({
			id: role.id,
			name: role.name,
			description: role.description,
			permissions: this.orderPermissions(permsByRole.get(role.id) ?? []),
			userCount: countByRole.get(role.id) ?? 0,
			createdAt: role.createdAt,
			updatedAt: role.updatedAt,
		}))
	}

	async createRole(payload: CreateRoleInput, actorId: string | null): Promise<Role> {
		const roleId = await db.transaction(async tx => {
			const [existing] = await tx.select().from(roles).where(eq(roles.name, payload.name))
			if (existing) {
				throw new ORPCError("CONFLICT", { message: `Role "${payload.name}" already exists` })
			}

			const [role] = await tx
				.insert(roles)
				.values({ name: payload.name, description: payload.description ?? null })
				.returning()

			if (!role) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Role could not be created" })
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_RBAC,
					action: "role.create",
					actorId,
					targetType: "role",
					targetId: String(role.id),
					oldValue: null,
					newValue: { name: role.name, description: role.description },
				},
				tx
			)

			return role.id
		})

		return this.buildRole(roleId)
	}

	async updateRole(payload: UpdateRoleRequest, actorId: string | null): Promise<Role> {
		const role = await this.getRoleRowOrThrow(payload.id)

		if (role.name === ADMIN_ROLE && payload.name !== undefined && payload.name !== ADMIN_ROLE) {
			await this.auditService.record({
				domain: AUDIT_DOMAIN_RBAC,
				action: "role.update",
				outcome: "denied",
				actorId,
				targetType: "role",
				targetId: String(role.id),
				oldValue: { name: role.name },
				newValue: { name: payload.name },
				reason: "The Admin role cannot be renamed",
			})
			throw new ORPCError("FORBIDDEN", { message: "The Admin role cannot be renamed" })
		}

		await db.transaction(async tx => {
			if (payload.name !== undefined && payload.name !== role.name) {
				const [clash] = await tx.select().from(roles).where(eq(roles.name, payload.name))
				if (clash) {
					throw new ORPCError("CONFLICT", { message: `Role "${payload.name}" already exists` })
				}
			}

			const next = {
				name: payload.name ?? role.name,
				description: payload.description !== undefined ? payload.description : role.description,
			}

			await tx
				.update(roles)
				.set({ ...next, updatedAt: new Date() })
				.where(eq(roles.id, role.id))

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_RBAC,
					action: "role.update",
					actorId,
					targetType: "role",
					targetId: String(role.id),
					oldValue: { name: role.name, description: role.description },
					newValue: next,
				},
				tx
			)
		})

		return this.buildRole(role.id)
	}

	async setRolePermissions(
		payload: SetRolePermissionsRequest,
		actorId: string | null
	): Promise<Role> {
		const role = await this.getRoleRowOrThrow(payload.id)

		const uniqueNames = Array.from(new Set(payload.permissions))
		const permissionRows = uniqueNames.length
			? await db.select().from(permissions).where(inArray(permissions.name, uniqueNames))
			: []

		const foundNames = new Set(permissionRows.map(p => p.name))
		const missing = uniqueNames.filter(name => !foundNames.has(name))
		if (missing.length) {
			throw new ORPCError("BAD_REQUEST", { message: `Unknown permissions: ${missing.join(", ")}` })
		}

		const previous = await db
			.select({ name: permissions.name })
			.from(rolePermissions)
			.innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
			.where(eq(rolePermissions.roleId, role.id))

		await db.transaction(async tx => {
			await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id))
			if (permissionRows.length) {
				await tx
					.insert(rolePermissions)
					.values(permissionRows.map(p => ({ roleId: role.id, permissionId: p.id })))
			}

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_RBAC,
					action: "role.setPermissions",
					actorId,
					targetType: "role",
					targetId: String(role.id),
					oldValue: { permissions: previous.map(p => p.name).sort() },
					newValue: { permissions: uniqueNames.slice().sort() },
				},
				tx
			)
		})

		await this.cacheService.clear()
		return this.buildRole(role.id)
	}

	async deleteRole(id: number, actorId: string | null): Promise<{ success: boolean; id: number }> {
		const role = await this.getRoleRowOrThrow(id)

		if (role.name === ADMIN_ROLE) {
			await this.auditService.record({
				domain: AUDIT_DOMAIN_RBAC,
				action: "role.delete",
				outcome: "denied",
				actorId,
				targetType: "role",
				targetId: String(role.id),
				oldValue: { name: role.name },
				reason: "The Admin role cannot be deleted",
			})
			throw new ORPCError("FORBIDDEN", { message: "The Admin role cannot be deleted" })
		}

		const grantedPermissions = await db
			.select({ name: permissions.name })
			.from(rolePermissions)
			.innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
			.where(eq(rolePermissions.roleId, role.id))

		await db.transaction(async tx => {
			await tx.delete(roles).where(eq(roles.id, role.id))

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_RBAC,
					action: "role.delete",
					actorId,
					targetType: "role",
					targetId: String(role.id),
					oldValue: {
						name: role.name,
						description: role.description,
						permissions: grantedPermissions.map(p => p.name).sort(),
					},
					newValue: null,
				},
				tx
			)
		})

		await this.cacheService.clear()
		return { success: true, id: role.id }
	}

	// ---------------------------------------------------------- permissions
	async listPermissions(): Promise<PermissionCatalogEntry[]> {
		const rows = await db.select().from(permissions)
		const descByName = new Map(rows.map(row => [row.name, row.description]))

		return PERMISSION_NAMES.filter(name => descByName.has(name)).map(name => ({
			name,
			description: descByName.get(name) ?? null,
		}))
	}

	// ---------------------------------------------------------------- users
	async listUsers(
		query: ListUsersRequest,
		includeDirectory: boolean
	): Promise<ListUsersResponse> {
		const { items } = await this.queryFilteredUsers(query, includeDirectory)
		const total = items.length
		const pageSize = query.pageSize ?? 20
		const totalPages = Math.max(1, Math.ceil(total / pageSize))
		const page = Math.min(query.page ?? 1, totalPages)
		const offset = (page - 1) * pageSize

		return {
			items: items.slice(offset, offset + pageSize),
			total,
			page,
			pageSize,
			totalPages,
		}
	}

	async exportUsers(
		query: ExportUsersRequest,
		includeDirectory: boolean
	): Promise<ExportUsersResponse> {
		const { items } = await this.queryFilteredUsers(query, includeDirectory)
		const rows = items.map(user => ({
			name: user.name ?? "",
			email: includeDirectory ? user.email : "[redacted]",
			accountType: user.accountType,
			status: user.status,
			roles: user.roles.join(", "),
			createdAt: user.createdAt.toISOString(),
		}))

		const dateStamp = new Date().toISOString().slice(0, 10)
		const exported = await this.exportService.exportTable({
			format: query.format,
			fileBaseName: `qsps-users-${dateStamp}`,
			title: "QSPS User Accounts",
			columns: [
				{ key: "name", header: "Name" },
				{ key: "email", header: "Email" },
				{ key: "accountType", header: "Account Type" },
				{ key: "status", header: "Status" },
				{ key: "roles", header: "Roles" },
				{ key: "createdAt", header: "Created At (UTC)" },
			],
			rows,
		})

		return {
			fileName: exported.fileName,
			mimeType: exported.mimeType,
			contentBase64: exported.buffer.toString("base64"),
		}
	}

	async createUser(
		payload: CreateStaffUserInput,
		actorId: string | null
	): Promise<UserWithRoles> {
		const normalizedEmail = payload.email.trim().toLowerCase()
		const uniqueRoleNames = Array.from(new Set(payload.roles))

		const createdUser = await this.runUserGuarded(
			{
				action: "user.create",
				actorId,
				targetId: normalizedEmail,
				attempted: { accountType: "staff", roles: uniqueRoleNames },
			},
			async tx => {
				const roleRows = await tx
					.select()
					.from(roles)
					.where(inArray(roles.name, uniqueRoleNames))

				const foundRoleNames = new Set(roleRows.map(r => r.name))
				const missingRoles = uniqueRoleNames.filter(name => !foundRoleNames.has(name))
				if (missingRoles.length > 0) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Unknown roles: ${missingRoles.join(", ")}`,
					})
				}

				if (uniqueRoleNames.includes(ADMIN_ROLE)) {
					const actorIsAdmin = actorId ? await this.rbacService.holdsAdmin(tx, actorId) : false
					if (!actorIsAdmin) {
						throw new PrivilegeGuardError(
							"FORBIDDEN",
							"Only a Super Admin may assign the Super Admin role",
							"caller is not a Super Admin"
						)
					}
				}

				const [existing] = await tx
					.select({ id: users.id })
					.from(users)
					.where(eq(users.email, normalizedEmail))
				if (existing) {
					throw new ORPCError("CONFLICT", {
						message: "An account with this email address already exists",
					})
				}

				const userId = randomUUID()
				const now = new Date()
				const [inserted] = await tx
					.insert(users)
					.values({
						id: userId,
						name: payload.name.trim(),
						email: normalizedEmail,
						emailVerified: true,
						accountType: "staff",
						mustResetPassword: true,
						createdAt: now,
						updatedAt: now,
					})
					.returning()

				if (!inserted) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message: "Staff account could not be created",
					})
				}

				await tx.insert(userRoles).values(
					roleRows.map(role => ({
						userId: inserted.id,
						roleId: role.id,
					}))
				)

				// Rule 5: Never record personal data (name, email, mobile, birthDate) in audit values.
				await this.auditService.record(
					{
						domain: AUDIT_DOMAIN_RBAC,
						action: "user.create",
						actorId,
						targetType: "user",
						targetId: inserted.id,
						oldValue: null,
						newValue: {
							accountType: "staff",
							mustResetPassword: true,
							roles: uniqueRoleNames.slice().sort(),
						},
					},
					tx
				)

				return {
					id: inserted.id,
					name: inserted.name,
					email: inserted.email,
					accountType: "staff" as const,
					status: "active" as const,
					roles: uniqueRoleNames.slice().sort(),
					disabledAt: null,
					deletedAt: null,
					createdAt: inserted.createdAt,
				}
			}
		)

		await this.sendStaffInvitationEmail(createdUser.email)
		return createdUser
	}

	async updateUser(
		payload: UpdateUserRequest,
		actorId: string | null
	): Promise<UserWithRoles> {
		const updated = await db.transaction(async tx => {
			const [current] = await tx
				.select()
				.from(users)
				.where(and(eq(users.id, payload.userId), isNull(users.deletedAt)))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `User "${payload.userId}" was not found` })
			}

			const changedFields: string[] = []
			const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }

			if (payload.name !== undefined && payload.name.trim() !== current.name) {
				updates.name = payload.name.trim()
				changedFields.push("name")
			}

			if (payload.email !== undefined) {
				const nextEmail = payload.email.trim().toLowerCase()
				if (nextEmail !== current.email.toLowerCase()) {
					const [clash] = await tx
						.select({ id: users.id })
						.from(users)
						.where(eq(users.email, nextEmail))
					if (clash) {
						throw new ORPCError("CONFLICT", {
							message: "An account with this email address already exists",
						})
					}
					updates.email = nextEmail
					changedFields.push("email")
				}
			}

			const [saved] =
				changedFields.length > 0
					? await tx
							.update(users)
							.set(updates)
							.where(eq(users.id, current.id))
							.returning()
					: [current]

			if (!saved) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "User could not be updated" })
			}

			// Rule 5: Record which fields changed, never personal data values.
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_RBAC,
					action: "user.update",
					actorId,
					targetType: "user",
					targetId: current.id,
					oldValue: { fields: changedFields },
					newValue: { changedFields },
				},
				tx
			)

			const roleRows = await tx
				.select({ name: roles.name })
				.from(userRoles)
				.innerJoin(roles, eq(userRoles.roleId, roles.id))
				.where(eq(userRoles.userId, saved.id))

			return this.toUserWithRoles(
				saved,
				roleRows.map(r => r.name),
				true
			)
		})

		return updated
	}

	async setUserStatus(
		payload: SetUserStatusRequest,
		actorId: string | null
	): Promise<UserWithRoles> {
		const action = payload.isActive ? "user.enable" : "user.disable"

		const updated = await this.runUserGuarded(
			{
				action,
				actorId,
				targetId: payload.userId,
				attempted: { isActive: payload.isActive },
			},
			async tx => {
				const [current] = await tx
					.select()
					.from(users)
					.where(and(eq(users.id, payload.userId), isNull(users.deletedAt)))
				if (!current) {
					throw new ORPCError("NOT_FOUND", { message: `User "${payload.userId}" was not found` })
				}

				if (!payload.isActive) {
					await this.rbacService.assertCanDeactivateUser(tx, current.id, actorId)
				}

				const now = new Date()
				const nextDisabledAt = payload.isActive ? null : (current.disabledAt ?? now)

				const [saved] = await tx
					.update(users)
					.set({ disabledAt: nextDisabledAt, updatedAt: now })
					.where(eq(users.id, current.id))
					.returning()

				if (!saved) {
					throw new ORPCError("INTERNAL_SERVER_ERROR", {
						message: "User status could not be updated",
					})
				}

				// Revoke all active sessions immediately upon disabling.
				if (!payload.isActive) {
					await tx.delete(sessions).where(eq(sessions.userId, current.id))
				}

				await this.auditService.record(
					{
						domain: AUDIT_DOMAIN_RBAC,
						action,
						actorId,
						targetType: "user",
						targetId: current.id,
						oldValue: { status: current.disabledAt ? "disabled" : "active" },
						newValue: { status: payload.isActive ? "active" : "disabled" },
					},
					tx
				)

				const roleRows = await tx
					.select({ name: roles.name })
					.from(userRoles)
					.innerJoin(roles, eq(userRoles.roleId, roles.id))
					.where(eq(userRoles.userId, saved.id))

				return this.toUserWithRoles(
					saved,
					roleRows.map(r => r.name),
					true
				)
			}
		)

		await this.cacheService.invalidate(payload.userId)
		return updated
	}

	async deleteUser(userId: string, actorId: string | null): Promise<DeleteUserResponse> {
		await this.runUserGuarded(
			{
				action: "user.delete",
				actorId,
				targetId: userId,
				attempted: { deleted: true },
			},
			async tx => {
				const [current] = await tx
					.select()
					.from(users)
					.where(and(eq(users.id, userId), isNull(users.deletedAt)))
				if (!current) {
					throw new ORPCError("NOT_FOUND", { message: `User "${userId}" was not found` })
				}

				await this.rbacService.assertCanDeactivateUser(tx, current.id, actorId)

				const now = new Date()
				// Soft delete: retain the user row, history, and audit entries.
				await tx
					.update(users)
					.set({
						deletedAt: now,
						disabledAt: current.disabledAt ?? now,
						updatedAt: now,
					})
					.where(eq(users.id, current.id))

				// Revoke all active sessions so the deleted user cannot stay signed in.
				await tx.delete(sessions).where(eq(sessions.userId, current.id))

				await this.auditService.record(
					{
						domain: AUDIT_DOMAIN_RBAC,
						action: "user.delete",
						actorId,
						targetType: "user",
						targetId: current.id,
						oldValue: { status: current.disabledAt ? "disabled" : "active" },
						newValue: { status: "deleted" },
					},
					tx
				)
			}
		)

		await this.cacheService.invalidate(userId)
		return { success: true, userId }
	}

	async assignUserRole(payload: AssignRoleRequest, actorId: string | null) {
		await this.rbacService.assignRole(payload.userId, payload.roleName, actorId)
		return { success: true, userId: payload.userId, roleName: payload.roleName }
	}

	async removeUserRole(payload: RemoveRoleRequest, actorId: string | null) {
		await this.rbacService.removeRole(payload.userId, payload.roleName, actorId)
		return { success: true, userId: payload.userId, roleName: payload.roleName }
	}

	// ------------------------------------------------------------ audit log
	async listAuditLog(query: ListAuditLogRequest): Promise<ListAuditLogResponse> {
		return this.auditService.list(query)
	}

	// -------------------------------------------------------------- helpers
	private async queryFilteredUsers(
		filters: UserFilterInput,
		includeDirectory: boolean
	): Promise<{ items: UserWithRoles[] }> {
		const conditions: SQL[] = []

		// Exclude soft-deleted users from the default list unless explicitly filtered.
		if (filters.status === "deleted") {
			conditions.push(isNotNull(users.deletedAt))
		} else if (filters.status === "disabled") {
			conditions.push(isNull(users.deletedAt), isNotNull(users.disabledAt))
		} else if (filters.status === "active") {
			conditions.push(isNull(users.deletedAt), isNull(users.disabledAt))
		} else {
			conditions.push(isNull(users.deletedAt))
		}

		if (filters.accountType) {
			conditions.push(eq(users.accountType, filters.accountType))
		}

		if (filters.search) {
			const pattern = `%${filters.search}%`
			const searchCondition = includeDirectory
				? or(ilike(users.name, pattern), ilike(users.email, pattern))
				: ilike(users.name, pattern)
			if (searchCondition) {
				conditions.push(searchCondition)
			}
		}

		const userRows = await db
			.select()
			.from(users)
			.where(and(...conditions))
			.orderBy(users.name, users.email)

		if (userRows.length === 0) {
			return { items: [] }
		}

		const userIds = userRows.map(u => u.id)
		const roleRows = await db
			.select({ userId: userRoles.userId, name: roles.name })
			.from(userRoles)
			.innerJoin(roles, eq(userRoles.roleId, roles.id))
			.where(inArray(userRoles.userId, userIds))

		const rolesByUser = new Map<string, string[]>()
		for (const row of roleRows) {
			const list = rolesByUser.get(row.userId) ?? []
			list.push(row.name)
			rolesByUser.set(row.userId, list)
		}

		let items = userRows.map(user =>
			this.toUserWithRoles(user, rolesByUser.get(user.id) ?? [], includeDirectory)
		)

		if (filters.role) {
			items = items.filter(user => user.roles.includes(filters.role!))
		}

		return { items }
	}

	private toUserWithRoles(
		user: typeof users.$inferSelect,
		assignedRoles: string[],
		includeDirectory: boolean
	): UserWithRoles {
		const status: UserAccountStatus = user.deletedAt
			? "deleted"
			: user.disabledAt
				? "disabled"
				: "active"
		const accountType: UserAccountType = user.accountType === "staff" ? "staff" : "client"

		return {
			id: user.id,
			name: user.name,
			email: includeDirectory ? user.email : "",
			accountType,
			status,
			roles: assignedRoles.slice().sort(),
			disabledAt: user.disabledAt,
			deletedAt: user.deletedAt,
			createdAt: user.createdAt,
		}
	}

	private async sendStaffInvitationEmail(email: string): Promise<void> {
		try {
			const { authEnv, getAuth } = await import("@repo/auth")
			const auth = getAuth()
			await auth.api.requestPasswordReset({
				body: {
					email,
					redirectTo: `${authEnv.APP_WEB_URL}/reset-password`,
				},
			})
		} catch {
			// Delivery errors are logged inside Better Auth's sendResetPassword handler;
			// the staff account is already committed and can be re-invited if needed.
		}
	}

	private async runUserGuarded<T>(
		context: {
			action: string
			actorId: string | null
			targetId: string
			attempted: Record<string, unknown>
		},
		work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
	): Promise<T> {
		try {
			return await db.transaction(work)
		} catch (error) {
			if (!(error instanceof PrivilegeGuardError)) throw error

			await this.auditService.record({
				domain: AUDIT_DOMAIN_RBAC,
				action: context.action,
				outcome: "denied",
				actorId: context.actorId,
				targetType: "user",
				targetId: context.targetId,
				newValue: context.attempted,
				reason: error.reason,
			})

			throw new ORPCError(error.kind, { message: error.message })
		}
	}

	private async getRoleRowOrThrow(id: number) {
		const [role] = await db.select().from(roles).where(eq(roles.id, id))
		if (!role) {
			throw new ORPCError("NOT_FOUND", { message: `Role with ID ${id} not found` })
		}
		return role
	}

	private async buildRole(id: number): Promise<Role> {
		const role = await this.getRoleRowOrThrow(id)

		const permRows = await db
			.select({ name: permissions.name })
			.from(rolePermissions)
			.innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
			.where(eq(rolePermissions.roleId, id))

		const [{ count } = { count: 0 }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(userRoles)
			.where(eq(userRoles.roleId, id))

		const grantedPermissions = permRows
			.map(p => p.name)
			.filter((name): name is PermissionName => PERMISSION_CATALOG.has(name))

		return {
			id: role.id,
			name: role.name,
			description: role.description,
			permissions: this.orderPermissions(grantedPermissions),
			userCount: count,
			createdAt: role.createdAt,
			updatedAt: role.updatedAt,
		}
	}

	private orderPermissions(names: PermissionName[]): PermissionName[] {
		const held = new Set(names)
		return PERMISSION_NAMES.filter(name => held.has(name))
	}
}