import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, eq, isNull } from "drizzle-orm"

import { ADMIN_ROLE, PERMISSION_NAMES, type MePermissions } from "@repo/contracts"
import {
	permissions,
	rolePermissions,
	roles,
	sessions,
	userRoles,
	users,
	userScopes,
} from "@repo/db/schema"

import { AUDIT_DOMAIN_RBAC, AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { RbacCacheService, type ResolvedPermissionSet } from "./rbac-cache.service"

/** The transaction handle Drizzle hands to `db.transaction`. */
export type TransactionLike = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * A privileged change refused by a guard inside the transaction.
 */
/**
 * AUTH-3 session hardening: when someone else changes a user's privileges, the
 * user's sessions end and they sign in again with the new access. Not when the
 * user changes their own, which would sign the admin out mid-task.
 */
export async function revokeSessionsAfterPrivilegeChange(
	tx: TransactionLike,
	userId: string,
	actorId: string | null
): Promise<void> {
	if (actorId === userId) return
	await tx.delete(sessions).where(eq(sessions.userId, userId))
}

export class PrivilegeGuardError extends Error {
	constructor(
		readonly kind: "FORBIDDEN" | "CONFLICT",
		message: string,
		readonly reason: string
	) {
		super(message)
		this.name = "PrivilegeGuardError"
	}
}

@Injectable()
export class RbacService {
	constructor(
		private readonly cacheService: RbacCacheService,
		private readonly auditService: AuditService
	) {}

	private async resolveForUser(userId: string): Promise<ResolvedPermissionSet> {
		const cached = await this.cacheService.get(userId)
		if (cached) return cached

		const rows = await db
			.select({
				roleName: roles.name,
				permissionName: permissions.name,
			})
			.from(userRoles)
			.innerJoin(roles, eq(userRoles.roleId, roles.id))
			.leftJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
			.leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
			.where(eq(userRoles.userId, userId))

		// ADM-2: Scope is resolved with the permissions it limits, and cached with them.
		const scopes = await db
			.select({
				serviceCategoryId: userScopes.serviceCategoryId,
				locationId: userScopes.locationId,
			})
			.from(userScopes)
			.where(eq(userScopes.userId, userId))

		const set: ResolvedPermissionSet = {
			roleNames: new Set<string>(),
			permissionNames: new Set<string>(),
			scopes,
		}

		for (const row of rows) {
			if (row.roleName) set.roleNames.add(row.roleName)
			if (row.permissionName) set.permissionNames.add(row.permissionName)
		}

		await this.cacheService.set(userId, set)
		return set
	}

	/**
	 * The user's roles, permissions and Scope rows, from the cache when present.
	 * `ScopeService` reads Scope through here so both share one cache entry.
	 */
	async getResolvedAccess(userId: string): Promise<ResolvedPermissionSet> {
		return this.resolveForUser(userId)
	}

	private static readonly permissionCatalog = new Set<string>(PERMISSION_NAMES)

	private matchPermission(set: ResolvedPermissionSet, permission: string): boolean {
		if (set.roleNames.has(ADMIN_ROLE)) return true

		// Fail-closed: unknown permissions (misspelled or non-catalog) are never granted.
		if (!RbacService.permissionCatalog.has(permission)) return false

		if (set.permissionNames.has(permission)) return true

		const resource = permission.split(":")[0]
		if (resource && set.permissionNames.has(`${resource}:*`)) return true

		return false
	}

	async hasRole(userId: string, role: string): Promise<boolean> {
		const set = await this.resolveForUser(userId)
		return set.roleNames.has(role)
	}

	async hasAnyRole(userId: string, rolesToCheck: string[]): Promise<boolean> {
		const set = await this.resolveForUser(userId)
		return rolesToCheck.some(r => set.roleNames.has(r))
	}

	async hasPermission(userId: string, permission: string): Promise<boolean> {
		const set = await this.resolveForUser(userId)
		return this.matchPermission(set, permission)
	}

	async hasAllPermissions(userId: string, permissionsToCheck: string[]): Promise<boolean> {
		const set = await this.resolveForUser(userId)
		return permissionsToCheck.every(p => this.matchPermission(set, p))
	}

	async getMissingPermissions(userId: string, permissionsToCheck: string[]): Promise<string[]> {
		const set = await this.resolveForUser(userId)
		return permissionsToCheck.filter(p => !this.matchPermission(set, p))
	}

	async recordPermissionDenial(denial: {
		actorId: string
		route: string
		requiredPermissions: string[]
		missingPermissions: string[]
	}): Promise<void> {
		await this.auditService.record({
			domain: AUDIT_DOMAIN_RBAC,
			action: "permission.check",
			outcome: "denied",
			actorId: denial.actorId,
			targetType: "route",
			targetId: denial.route,
			newValue: {
				requiredPermissions: denial.requiredPermissions,
				missingPermissions: denial.missingPermissions,
			},
			reason: "missing permission",
		})
	}

	async getUserAccess(userId: string): Promise<MePermissions> {
		const set = await this.resolveForUser(userId)

		return {
			roles: Array.from(set.roleNames).sort(),
			permissions: PERMISSION_NAMES.filter(permission => set.permissionNames.has(permission)),
		}
	}

	async holdsAdmin(tx: TransactionLike, candidateId: string): Promise<boolean> {
		const [row] = await tx
			.select({ userId: userRoles.userId })
			.from(userRoles)
			.innerJoin(roles, eq(userRoles.roleId, roles.id))
			.where(and(eq(userRoles.userId, candidateId), eq(roles.name, ADMIN_ROLE)))

		return Boolean(row)
	}

	/**
	 * Verifies that disabling or soft-deleting `targetUserId` neither allows a
	 * non-Super Admin to deactivate a Super Admin nor leaves zero active Super
	 * Admins in the system. Throws {@link PrivilegeGuardError} ("FORBIDDEN")
	 * when violated so the outer guard records an audited denial and returns 403.
	 */
	async assertCanDeactivateUser(
		tx: TransactionLike,
		targetUserId: string,
		actorId: string | null
	): Promise<void> {
		const [adminRole] = await tx.select().from(roles).where(eq(roles.name, ADMIN_ROLE))
		if (!adminRole) return

		const holders = await tx
			.select({
				userId: userRoles.userId,
				disabledAt: users.disabledAt,
				deletedAt: users.deletedAt,
			})
			.from(userRoles)
			.innerJoin(users, eq(userRoles.userId, users.id))
			.where(eq(userRoles.roleId, adminRole.id))
			.for("update")

		const targetIsAdmin = holders.some(h => h.userId === targetUserId)
		if (!targetIsAdmin) return

		const actorIsAdmin = actorId ? await this.holdsAdmin(tx, actorId) : false
		if (!actorIsAdmin) {
			throw new PrivilegeGuardError(
				"FORBIDDEN",
				"Only a Super Admin may disable or delete a Super Admin account",
				"caller is not a Super Admin"
			)
		}

		const activeHolders = holders.filter(h => h.disabledAt === null && h.deletedAt === null)
		const targetIsCurrentlyActive = activeHolders.some(h => h.userId === targetUserId)

		if (targetIsCurrentlyActive && activeHolders.length <= 1) {
			throw new PrivilegeGuardError(
				"FORBIDDEN",
				"Cannot disable or delete the last active Super Admin",
				"deactivation would leave zero active Super Admin holders"
			)
		}
	}

	async assignRole(userId: string, roleName: string, actorId: string | null): Promise<void> {
		await this.runGuarded(
			{
				action: "role.assign",
				actorId,
				targetType: "user",
				targetId: userId,
				attempted: { roleName },
			},
			async tx => {
				const [user] = await tx
					.select()
					.from(users)
					.where(and(eq(users.id, userId), isNull(users.deletedAt)))
				if (!user) throw new ORPCError("NOT_FOUND", { message: `User with ID ${userId} not found` })

				const [role] = await tx.select().from(roles).where(eq(roles.name, roleName))
				if (!role) throw new ORPCError("NOT_FOUND", { message: `Role "${roleName}" not found` })

				if (role.name === ADMIN_ROLE) {
					const actorIsAdmin = actorId ? await this.holdsAdmin(tx, actorId) : false
					if (!actorIsAdmin) {
						throw new PrivilegeGuardError(
							"FORBIDDEN",
							"Only an Admin may grant the Admin role",
							actorId === userId ? "self-escalation attempt" : "caller is not an Admin"
						)
					}
				}

				const [existing] = await tx
					.select()
					.from(userRoles)
					.where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)))

				await tx.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing()
				if (!existing) await revokeSessionsAfterPrivilegeChange(tx, userId, actorId)

				await this.auditService.record(
					{
						domain: AUDIT_DOMAIN_RBAC,
						action: "role.assign",
						actorId,
						targetType: "user",
						targetId: userId,
						oldValue: { roleHeld: Boolean(existing) },
						newValue: { roleHeld: true, roleName },
						reason: existing ? "already held; no change" : null,
					},
					tx
				)
			}
		)

		await this.cacheService.invalidate(userId)
	}

	async removeRole(userId: string, roleName: string, actorId: string | null): Promise<void> {
		await this.runGuarded(
			{
				action: "role.remove",
				actorId,
				targetType: "user",
				targetId: userId,
				attempted: { roleName },
			},
			async tx => {
				const [user] = await tx
					.select()
					.from(users)
					.where(and(eq(users.id, userId), isNull(users.deletedAt)))
				if (!user) throw new ORPCError("NOT_FOUND", { message: `User with ID ${userId} not found` })

				const [role] = await tx.select().from(roles).where(eq(roles.name, roleName))
				if (!role) throw new ORPCError("NOT_FOUND", { message: `Role "${roleName}" not found` })

				if (role.name === ADMIN_ROLE) {
					const actorIsAdmin = actorId ? await this.holdsAdmin(tx, actorId) : false
					if (!actorIsAdmin) {
						throw new PrivilegeGuardError(
							"FORBIDDEN",
							"Only a Super Admin may remove the Super Admin role",
							"caller is not a Super Admin"
						)
					}

					const holders = await tx
						.select({ userId: userRoles.userId })
						.from(userRoles)
						.where(eq(userRoles.roleId, role.id))
						.for("update")

					const targetHolds = holders.some(holder => holder.userId === userId)

					if (targetHolds && holders.length <= 1) {
						throw new PrivilegeGuardError(
							"CONFLICT",
							"Cannot remove the last Admin — at least one Admin must remain",
							"removal would leave zero Admin holders"
						)
					}
				}

				const removed = await tx
					.delete(userRoles)
					.where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id)))
					.returning()
				if (removed.length > 0) await revokeSessionsAfterPrivilegeChange(tx, userId, actorId)

				await this.auditService.record(
					{
						domain: AUDIT_DOMAIN_RBAC,
						action: "role.remove",
						actorId,
						targetType: "user",
						targetId: userId,
						oldValue: { roleHeld: removed.length > 0, roleName },
						newValue: { roleHeld: false },
						reason: removed.length ? null : "not held; no change",
					},
					tx
				)
			}
		)

		await this.cacheService.invalidate(userId)
	}

	async runGuarded(
		context: {
			action: string
			actorId: string | null
			targetType: string
			targetId: string
			attempted: Record<string, unknown>
		},
		work: (tx: TransactionLike) => Promise<void>
	): Promise<void> {
		try {
			await db.transaction(work)
		} catch (error) {
			if (!(error instanceof PrivilegeGuardError)) throw error

			await this.auditService.record({
				domain: AUDIT_DOMAIN_RBAC,
				action: context.action,
				outcome: "denied",
				actorId: context.actorId,
				targetType: context.targetType,
				targetId: context.targetId,
				newValue: context.attempted,
				reason: error.reason,
			})

			throw new ORPCError(error.kind, { message: error.message })
		}
	}
}