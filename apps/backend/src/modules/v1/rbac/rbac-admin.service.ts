import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"
import type { z } from "zod"

import {
	ADMIN_ROLE,
	MODULE_ADMIN_ASSIGNABLE_ROLES,
	PERMISSION_NAMES,
	ROLE_NAMES,
	type AssignRoleRequest,
	type CreateRoleInput,
	type CreateStaffUserInput,
	type AuditLogEntryDetail,
	type AuditLogFilter,
	type DeleteUserResponse,
	type ExportAuditLogRequest,
	type ExportAuditLogResponse,
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
	type ScopeEntryInput,
	type SetRolePermissionsRequest,
	type SetUserScopesRequest,
	type SetUserStatusRequest,
	type UpdateRoleRequest,
	type UpdateUserRequest,
	type UserAccountStatus,
	type UserAccountType,
	type UserFilterQuerySchema,
	type UserScopes,
	type UserWithRoles,
} from "@repo/contracts"
import {
	locations,
	permissions,
	rolePermissions,
	roles,
	serviceCategories,
	sessions,
	userRoles,
	users,
	userScopes,
} from "@repo/db/schema"

import {
	AUDIT_DOMAIN_AUDIT,
	AUDIT_DOMAIN_RBAC,
	AuditService,
} from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { ExportService } from "@/common/export/export.service"
import { RbacCacheService } from "@/common/rbac/rbac-cache.service"
import { PrivilegeGuardError, RbacService, type TransactionLike } from "@/common/rbac/rbac.service"
import { denyOutsideScope } from "@/common/scope/scope-denial"
import {
	NATIONWIDE_SCOPE,
	scopeContains,
	userWithinScope,
	type ResolvedScope,
} from "@/common/scope/scope-match"

const PERMISSION_CATALOG = new Set<string>(PERMISSION_NAMES)

/** Roles that may give any role (ADM-2). Everyone else with `users.accounts:manage` is a Module Admin. */
const FULL_ADMIN_ROLES = [ADMIN_ROLE, "System Admin"]

const ASSIGNABLE_BY_MODULE_ADMIN = new Set<string>(MODULE_ADMIN_ASSIGNABLE_ROLES)

/** ADM-7: the roles seeded with QSPS. Code refers to them by name, so they keep it. */
const SEEDED_ROLES = new Set<string>(ROLE_NAMES)

/** ADM-3: the most entries one audit export holds. Narrow the filters for more. */
const AUDIT_EXPORT_MAX_ROWS = 5000

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
			isSystem: SEEDED_ROLES.has(role.name),
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

	/**
	 * ADM-7: rename or re-describe a role. The Super Admin role cannot be changed
	 * at all, and the seeded roles keep their names (code refers to them by
	 * name). Both refusals are audited.
	 */
	async updateRole(payload: UpdateRoleRequest, actorId: string | null): Promise<Role> {
		const role = await this.getRoleRowOrThrow(payload.id)
		const attempted = { name: payload.name, description: payload.description }

		if (role.name === ADMIN_ROLE) {
			// FND-3's audit tests read "cannot be renamed" for a rename attempt.
			const renaming = payload.name !== undefined && payload.name !== role.name
			const message = renaming
				? `The ${ADMIN_ROLE} role cannot be renamed`
				: `The ${ADMIN_ROLE} role cannot be changed`
			await this.refuseRole(
				{ action: "role.update", actorId, role, attempted },
				"FORBIDDEN",
				message,
				renaming ? message : `the ${ADMIN_ROLE} role is protected`
			)
		}
		if (payload.name !== undefined && payload.name !== role.name && SEEDED_ROLES.has(role.name)) {
			await this.refuseRole(
				{ action: "role.update", actorId, role, attempted },
				"FORBIDDEN",
				"Built-in roles keep their name. You can still change their description and permissions.",
				"seeded role rename"
			)
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

	/**
	 * ADM-7: replace the permissions a role grants. Every grant and revoke is
	 * audited. The Super Admin role holds everything and cannot be edited, and
	 * only a Super Admin may grant a permission they do not hold themselves.
	 * The whole permission cache is cleared, so holders gain or lose access on
	 * their next request (the 60-second TTL is only the fallback).
	 */
	async setRolePermissions(
		payload: SetRolePermissionsRequest,
		actorId: string | null
	): Promise<Role> {
		const role = await this.getRoleRowOrThrow(payload.id)
		const uniqueNames = Array.from(new Set(payload.permissions))

		if (role.name === ADMIN_ROLE) {
			await this.refuseRole(
				{ action: "role.setPermissions", actorId, role, attempted: { permissions: uniqueNames } },
				"FORBIDDEN",
				`The ${ADMIN_ROLE} role holds every permission and cannot be changed`,
				`the ${ADMIN_ROLE} role is protected`
			)
		}

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

		const before = new Set(previous.map(p => p.name))
		const after = new Set<string>(uniqueNames)
		const granted = uniqueNames.filter(name => !before.has(name)).sort()
		const revoked = [...before].filter(name => !after.has(name)).sort()

		// No escalation through roles: below Super Admin, you can only hand out
		// what you already hold.
		if (granted.length > 0 && actorId) {
			const access = await this.rbacService.getResolvedAccess(actorId)
			if (!access.roleNames.has(ADMIN_ROLE)) {
				const notHeld = granted.filter(name => {
					const resource = name.split(":")[0]
					return !access.permissionNames.has(name) && !access.permissionNames.has(`${resource}:*`)
				})
				if (notHeld.length > 0) {
					await this.refuseRole(
						{ action: "role.setPermissions", actorId, role, attempted: { granted } },
						"FORBIDDEN",
						`You can only grant permissions you hold yourself: ${notHeld.join(", ")}`,
						`grants permissions the caller does not hold: ${notHeld.join(", ")}`
					)
				}
			}
		}

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
					oldValue: { permissions: [...before].sort() },
					newValue: { permissions: uniqueNames.slice().sort(), granted, revoked },
				},
				tx
			)
		})

		await this.cacheService.clear()
		return this.buildRole(role.id)
	}

	/**
	 * ADM-7: delete a custom role. Refused (and audited) for Super Admin, for
	 * the seeded roles, and for any role still assigned to a user: unassign it
	 * first, so nobody loses access as a side effect of a delete.
	 */
	async deleteRole(id: number, actorId: string | null): Promise<{ success: boolean; id: number }> {
		const role = await this.getRoleRowOrThrow(id)

		if (role.name === ADMIN_ROLE) {
			await this.refuseRole(
				{ action: "role.delete", actorId, role },
				"FORBIDDEN",
				`The ${ADMIN_ROLE} role cannot be deleted`,
				`The ${ADMIN_ROLE} role cannot be deleted`
			)
		}
		if (SEEDED_ROLES.has(role.name)) {
			await this.refuseRole(
				{ action: "role.delete", actorId, role },
				"FORBIDDEN",
				"Built-in roles cannot be deleted",
				"seeded role delete"
			)
		}

		const [{ count: holders } = { count: 0 }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(userRoles)
			.where(eq(userRoles.roleId, role.id))
		if (holders > 0) {
			await this.refuseRole(
				{ action: "role.delete", actorId, role, attempted: { assignedUsers: holders } },
				"CONFLICT",
				`This role is assigned to ${holders === 1 ? "1 user" : `${holders} users`}. Remove it from them before deleting it.`,
				"role still assigned"
			)
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

	/** Audits a refused role change, then throws the matching API error. */
	private async refuseRole(
		context: {
			action: string
			actorId: string | null
			role: { id: number; name: string }
			attempted?: Record<string, unknown>
		},
		code: "FORBIDDEN" | "CONFLICT",
		message: string,
		reason: string
	): Promise<never> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_RBAC,
			action: context.action,
			outcome: "denied",
			actorId: context.actorId,
			targetType: "role",
			targetId: String(context.role.id),
			oldValue: { name: context.role.name },
			newValue: context.attempted ?? null,
			reason,
		})
		throw new ORPCError(code, { message })
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
		includeDirectory: boolean,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ListUsersResponse> {
		const { items } = await this.queryFilteredUsers(query, includeDirectory, scope)
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

	/**
	 * Export the filtered user list as CSV, XLSX or PDF.
	 *
	 * A bulk export of personal data, so every export is audited (who, which
	 * format and filters, how many rows) — never the names or emails exported,
	 * and never the search text, which is often a person's name.
	 */
	async exportUsers(
		query: ExportUsersRequest,
		includeDirectory: boolean,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<ExportUsersResponse> {
		const { items } = await this.queryFilteredUsers(query, includeDirectory, scope)
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

		// Nothing to roll back: the export only reads, so the entry stands alone.
		await this.auditService.record({
			domain: AUDIT_DOMAIN_RBAC,
			action: "user.export",
			actorId,
			targetType: "user",
			targetId: null,
			newValue: {
				format: query.format,
				filters: {
					status: query.status ?? null,
					accountType: query.accountType ?? null,
					role: query.role ?? null,
					search: Boolean(query.search),
				},
				includesEmails: includeDirectory,
				rowCount: rows.length,
			},
		})

		return {
			fileName: exported.fileName,
			mimeType: exported.mimeType,
			contentBase64: exported.buffer.toString("base64"),
		}
	}

	async createUser(
		payload: CreateStaffUserInput,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<UserWithRoles> {
		const normalizedEmail = payload.email.trim().toLowerCase()
		const uniqueRoleNames = Array.from(new Set(payload.roles))
		const newScopes = uniqueScopes(payload.scopes ?? [])

		// ADM-2: a scoped admin's new staff must land inside their own Scope, or
		// the admin could not see or manage the account they just made.
		if (!scope.nationwide && newScopes.length === 0) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Choose at least one service category and location for this account",
			})
		}

		const createdUser = await this.runUserGuarded(
			{
				action: "user.create",
				actorId,
				targetId: normalizedEmail,
				attempted: { accountType: "staff", roles: uniqueRoleNames },
			},
			async tx => {
				const roleRows = await tx.select().from(roles).where(inArray(roles.name, uniqueRoleNames))

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

				// ADM-2: a Module Admin gives only the roles below Module Admin.
				// The actor's roles are read only when a higher role is asked for.
				const tooHigh = uniqueRoleNames.filter(name => !ASSIGNABLE_BY_MODULE_ADMIN.has(name))
				if (tooHigh.length > 0 && actorId && !(await this.isFullAdmin(tx, actorId))) {
					throw new PrivilegeGuardError(
						"FORBIDDEN",
						`You can give only these roles: ${MODULE_ADMIN_ASSIGNABLE_ROLES.join(", ")}`,
						`role above Module Admin: ${tooHigh.join(", ")}`
					)
				}

				await this.assertScopesAllowed(tx, scope, newScopes)

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

				if (newScopes.length > 0) {
					await tx
						.insert(userScopes)
						.values(newScopes.map(entry => ({ userId: inserted.id, ...entry })))
				}

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
							...(newScopes.length > 0 ? { scopes: newScopes } : {}),
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
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<UserWithRoles> {
		const updated = await db.transaction(async tx => {
			const [current] = await tx
				.select()
				.from(users)
				.where(and(eq(users.id, payload.userId), isNull(users.deletedAt)))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `User "${payload.userId}" was not found` })
			}
			await this.requireUserInScope(tx, scope, actorId, current.id)

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
					? await tx.update(users).set(updates).where(eq(users.id, current.id)).returning()
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
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
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
				await this.requireUserInScope(tx, scope, actorId, current.id)

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

	async deleteUser(
		userId: string,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<DeleteUserResponse> {
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
				await this.requireUserInScope(tx, scope, actorId, current.id)

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

	// --------------------------------------------------------------- scopes
	/** ADM-2: a user's Scope rows. A user outside the caller's Scope answers 404. */
	async getUserScopes(
		userId: string,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<UserScopes> {
		return db.transaction(async tx => {
			const [current] = await tx
				.select({ id: users.id })
				.from(users)
				.where(and(eq(users.id, userId), isNull(users.deletedAt)))
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `User "${userId}" was not found` })
			}
			await this.requireUserInScope(tx, scope, actorId, current.id)
			return { userId: current.id, scopes: await this.scopesOf(tx, current.id) }
		})
	}

	/**
	 * ADM-2: replace a staff user's Scope. The old and new rows are audited in
	 * the same transaction, and the user's cached permissions are dropped so
	 * the new Scope applies on their next request.
	 */
	async setUserScopes(
		payload: SetUserScopesRequest,
		actorId: string | null,
		scope: ResolvedScope = NATIONWIDE_SCOPE
	): Promise<UserScopes> {
		const nextScopes = uniqueScopes(payload.scopes)

		const saved = await this.runUserGuarded(
			{
				action: "user.scopes.set",
				actorId,
				targetId: payload.userId,
				attempted: { scopes: nextScopes },
			},
			async tx => {
				const [current] = await tx
					.select({ id: users.id, accountType: users.accountType })
					.from(users)
					.where(and(eq(users.id, payload.userId), isNull(users.deletedAt)))
				if (!current) {
					throw new ORPCError("NOT_FOUND", { message: `User "${payload.userId}" was not found` })
				}
				await this.requireUserInScope(tx, scope, actorId, current.id)
				if (current.accountType !== "staff") {
					throw new ORPCError("BAD_REQUEST", { message: "Only staff accounts have a scope" })
				}
				await this.assertScopesAllowed(tx, scope, nextScopes)

				const previous = await this.scopesOf(tx, current.id)
				await tx.delete(userScopes).where(eq(userScopes.userId, current.id))
				if (nextScopes.length > 0) {
					await tx
						.insert(userScopes)
						.values(nextScopes.map(entry => ({ userId: current.id, ...entry })))
				}

				await this.auditService.record(
					{
						domain: AUDIT_DOMAIN_RBAC,
						action: "user.scopes.set",
						actorId,
						targetType: "user",
						targetId: current.id,
						oldValue: { scopes: previous },
						newValue: { scopes: nextScopes },
					},
					tx
				)
				return { userId: current.id, scopes: nextScopes }
			}
		)

		await this.cacheService.invalidate(payload.userId)
		return saved
	}

	async removeUserRole(payload: RemoveRoleRequest, actorId: string | null) {
		await this.rbacService.removeRole(payload.userId, payload.roleName, actorId)
		return { success: true, userId: payload.userId, roleName: payload.roleName }
	}

	// ------------------------------------------------------------ audit log
	/** ADM-3: filtered, newest first, cursor paged. Read-only: there is no edit or delete. */
	async listAuditLog(query: ListAuditLogRequest): Promise<ListAuditLogResponse> {
		assertDateRange(query)
		return this.auditService.list(query)
	}

	/** ADM-3: one entry with its old and new values, IP address and device. */
	async getAuditEntry(id: number): Promise<AuditLogEntryDetail> {
		const entry = await this.auditService.get(id)
		if (!entry) {
			throw new ORPCError("NOT_FOUND", { message: `Audit entry ${id} was not found` })
		}
		return entry
	}

	/**
	 * ADM-3: export the entries matching the filters as CSV or PDF, through
	 * ExportService. The export is itself audited: who, which format and
	 * filters, how many rows. The actor filter is recorded only as given or
	 * not, because it is often a person's email.
	 */
	async exportAuditLog(
		query: ExportAuditLogRequest,
		actorId: string | null
	): Promise<ExportAuditLogResponse> {
		assertDateRange(query)
		const { format, ...filters } = query

		const { entries, nextCursor } = await this.auditService.list({
			...filters,
			limit: AUDIT_EXPORT_MAX_ROWS,
		})
		const truncated = nextCursor !== null

		const rows = entries.map(entry => ({
			id: entry.id,
			createdAt: entry.createdAt.toISOString(),
			actor: entry.actorEmail ?? entry.actorId ?? "System",
			actorRole: entry.actorRole ?? "",
			domain: entry.domain,
			action: entry.action,
			outcome: entry.outcome,
			target: entry.targetType
				? `${entry.targetType}${entry.targetId ? `: ${entry.targetId}` : ""}`
				: "",
			reason: entry.reason ?? "",
			ipAddress: entry.ipAddress ?? "",
			userAgent: entry.userAgent ?? "",
			oldValue: jsonCell(entry.oldValue),
			newValue: jsonCell(entry.newValue),
		}))

		type Row = (typeof rows)[number]
		const csvColumns: { key: keyof Row & string; header: string }[] = [
			{ key: "id", header: "ID" },
			{ key: "createdAt", header: "When (UTC)" },
			{ key: "actor", header: "Actor" },
			{ key: "actorRole", header: "Actor role" },
			{ key: "domain", header: "Domain" },
			{ key: "action", header: "Action" },
			{ key: "outcome", header: "Outcome" },
			{ key: "target", header: "Target" },
			{ key: "reason", header: "Reason" },
			{ key: "ipAddress", header: "IP address" },
			{ key: "userAgent", header: "Device" },
			{ key: "oldValue", header: "Old value" },
			{ key: "newValue", header: "New value" },
		]
		// A landscape page fits about nine readable columns; the CSV has everything.
		const pdfKeys = new Set<string>([
			"id",
			"createdAt",
			"actor",
			"actorRole",
			"action",
			"outcome",
			"target",
			"reason",
			"ipAddress",
		])

		const dateStamp = new Date().toISOString().slice(0, 10)
		const exported = await this.exportService.exportTable({
			format,
			fileBaseName: `qsps-audit-log-${dateStamp}`,
			title: "QSPS Audit Log",
			columns: format === "pdf" ? csvColumns.filter(c => pdfKeys.has(c.key)) : csvColumns,
			rows,
		})

		// Nothing to roll back: the export only reads, so the entry stands alone.
		await this.auditService.record({
			domain: AUDIT_DOMAIN_AUDIT,
			action: "audit.export",
			actorId,
			targetType: "audit_log",
			targetId: null,
			newValue: {
				format,
				filters: auditFiltersForRecord(filters),
				rowCount: rows.length,
				truncated,
			},
		})

		return {
			fileName: exported.fileName,
			mimeType: exported.mimeType,
			contentBase64: exported.buffer.toString("base64"),
			rowCount: rows.length,
			truncated,
		}
	}

	// -------------------------------------------------------------- helpers
	private async queryFilteredUsers(
		filters: UserFilterInput,
		includeDirectory: boolean,
		scope: ResolvedScope = NATIONWIDE_SCOPE
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

		// ADM-2: a scoped admin sees only scoped staff whose Scope sits inside their own.
		if (!scope.nationwide) {
			const scopeRows = await db
				.select({
					userId: userScopes.userId,
					serviceCategoryId: userScopes.serviceCategoryId,
					locationId: userScopes.locationId,
				})
				.from(userScopes)
				.where(inArray(userScopes.userId, userIds))
			const scopesByUser = new Map<
				string,
				{ serviceCategoryId: number | null; locationId: number | null }[]
			>()
			for (const { userId, ...entry } of scopeRows) {
				const list = scopesByUser.get(userId) ?? []
				list.push(entry)
				scopesByUser.set(userId, list)
			}
			items = items.filter(user =>
				userWithinScope(scope, {
					roleNames: new Set(user.roles),
					scopes: scopesByUser.get(user.id) ?? [],
				})
			)
		}

		if (filters.role) {
			items = items.filter(user => user.roles.includes(filters.role!))
		}

		return { items }
	}

	private async scopesOf(tx: TransactionLike, userId: string): Promise<ScopeEntryInput[]> {
		const rows = await tx
			.select({
				serviceCategoryId: userScopes.serviceCategoryId,
				locationId: userScopes.locationId,
			})
			.from(userScopes)
			.where(eq(userScopes.userId, userId))
		return rows
	}

	/**
	 * ADM-2: every category and location named must exist, and a scoped admin
	 * may give only scopes inside their own (refused as a 403 and audited).
	 */
	private async assertScopesAllowed(
		tx: TransactionLike,
		scope: ResolvedScope,
		entries: ScopeEntryInput[]
	): Promise<void> {
		if (entries.length === 0) return

		const categoryIds = [...new Set(entries.flatMap(entry => entry.serviceCategoryId ?? []))]
		if (categoryIds.length > 0) {
			const found = await tx
				.select({ id: serviceCategories.id })
				.from(serviceCategories)
				.where(inArray(serviceCategories.id, categoryIds))
			if (found.length !== categoryIds.length) {
				throw new ORPCError("BAD_REQUEST", { message: "A chosen service category does not exist" })
			}
		}

		const locationIds = [...new Set(entries.flatMap(entry => entry.locationId ?? []))]
		if (locationIds.length > 0) {
			const found = await tx
				.select({ id: locations.id })
				.from(locations)
				.where(inArray(locations.id, locationIds))
			if (found.length !== locationIds.length) {
				throw new ORPCError("BAD_REQUEST", { message: "A chosen location does not exist" })
			}
		}

		if (!scopeContains(scope, entries)) {
			throw new PrivilegeGuardError(
				"FORBIDDEN",
				"You can only give service categories and locations inside your own scope",
				"scope outside the caller's scope"
			)
		}
	}

	/** Super Admin or System Admin: may give any role. */
	private async isFullAdmin(tx: TransactionLike, actorId: string): Promise<boolean> {
		const [row] = await tx
			.select({ userId: userRoles.userId })
			.from(userRoles)
			.innerJoin(roles, eq(userRoles.roleId, roles.id))
			.where(and(eq(userRoles.userId, actorId), inArray(roles.name, FULL_ADMIN_ROLES)))
			.limit(1)
		return Boolean(row)
	}

	/**
	 * ADM-2: a user outside the caller's Scope answers like a missing one, and
	 * the attempt is audited as denied.
	 */
	private async requireUserInScope(
		tx: TransactionLike,
		scope: ResolvedScope,
		actorId: string | null,
		userId: string
	): Promise<void> {
		if (scope.nationwide) return

		const roleRows = await tx
			.select({ name: roles.name })
			.from(userRoles)
			.innerJoin(roles, eq(userRoles.roleId, roles.id))
			.where(eq(userRoles.userId, userId))
		const scopeRows = await tx
			.select({
				serviceCategoryId: userScopes.serviceCategoryId,
				locationId: userScopes.locationId,
			})
			.from(userScopes)
			.where(eq(userScopes.userId, userId))

		const target = { roleNames: new Set(roleRows.map(row => row.name)), scopes: scopeRows }
		if (userWithinScope(scope, target)) return

		await denyOutsideScope(this.auditService, actorId, {
			type: "user",
			id: userId,
			notFoundMessage: `User "${userId}" was not found`,
		})
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
			isSystem: SEEDED_ROLES.has(role.name),
			createdAt: role.createdAt,
			updatedAt: role.updatedAt,
		}
	}

	private orderPermissions(names: PermissionName[]): PermissionName[] {
		const held = new Set(names)
		return PERMISSION_NAMES.filter(name => held.has(name))
	}
}

/** ADM-3: refuse a date range that ends before it starts. */
function assertDateRange(filter: AuditLogFilter): void {
	if (filter.from && filter.to && filter.from > filter.to) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The start date must be on or before the end date",
		})
	}
}

/** The filters as stored in the export's own audit entry. */
function auditFiltersForRecord(filter: AuditLogFilter): Record<string, unknown> {
	return {
		from: filter.from ?? null,
		to: filter.to ?? null,
		actor: Boolean(filter.actor),
		role: filter.role ?? null,
		domain: filter.domain ?? null,
		action: filter.action ?? null,
		outcome: filter.outcome ?? null,
		targetType: filter.targetType ?? null,
		targetId: filter.targetId ?? null,
	}
}

/** Old and new values are JSON; text stays as it is. */
function jsonCell(value: unknown): string {
	if (value === null || value === undefined) return ""
	if (typeof value === "string") return value
	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

/** The same Scope row given twice is stored once. */
function uniqueScopes(entries: readonly ScopeEntryInput[]): ScopeEntryInput[] {
	const seen = new Set<string>()
	const unique: ScopeEntryInput[] = []
	for (const entry of entries) {
		const key = `${entry.serviceCategoryId ?? "*"}:${entry.locationId ?? "*"}`
		if (seen.has(key)) continue
		seen.add(key)
		unique.push({ serviceCategoryId: entry.serviceCategoryId, locationId: entry.locationId })
	}
	return unique
}