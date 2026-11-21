import { and, eq, or, sql, type Column, type SQL } from "drizzle-orm"

import type { ResolvedPermissionSet, ScopeEntry } from "@/common/rbac/rbac-cache.service"

/**
 * What a user may act on (ADM-2). Nationwide roles see everything; every
 * other user sees what their `user_scopes` rows cover, and nothing when they
 * have none (DOMAIN-MODEL: "No rows means no scoped access for scoped roles").
 */
/**
 * Roles that act nationwide. Same list as `NATIONWIDE_ROLES` in
 * packages/contracts/src/modules/v1/rbac/rbac.catalog.ts; keep the two in step.
 * Copied rather than imported: the contracts entry point loads @orpc/contract,
 * which Jest (CommonJS) cannot read, and every service using Scope would fail
 * to load in tests.
 */
const NATIONWIDE_ROLES: readonly string[] = ["Super Admin", "System Admin", "Auditor"]

export type ResolvedScope = { nationwide: true } | { nationwide: false; entries: ScopeEntry[] }

/**
 * The Scope dimensions a record has. Leave out a dimension the record does
 * not have: a Location has no Service Category, a Service has no Location.
 */
export type ScopedRecord = {
	serviceCategoryId?: number
	locationId?: number
}

/** The columns that hold a query's Scope dimensions. Leave out what the query lacks. */
export type ScopeColumns = {
	serviceCategoryId?: Column
	locationId?: Column
}

/** No limit. The default for service methods called without a Scope (System jobs, tests). */
export const NATIONWIDE_SCOPE: ResolvedScope = { nationwide: true }

export function toResolvedScope(
	access: Pick<ResolvedPermissionSet, "roleNames" | "scopes">
): ResolvedScope {
	const nationwide = NATIONWIDE_ROLES.some(role => access.roleNames.has(role))
	return nationwide ? { nationwide: true } : { nationwide: false, entries: access.scopes }
}

/** One row covers a record when each dimension the record has is "all" or a match. */
function entryCovers(entry: ScopeEntry, record: ScopedRecord): boolean {
	const category =
		record.serviceCategoryId === undefined ||
		entry.serviceCategoryId === null ||
		entry.serviceCategoryId === record.serviceCategoryId
	const location =
		record.locationId === undefined ||
		entry.locationId === null ||
		entry.locationId === record.locationId
	return category && location
}

/** Whether the user may act on this record. */
export function inScope(scope: ResolvedScope, record: ScopedRecord): boolean {
	if (scope.nationwide) return true
	return scope.entries.some(entry => entryCovers(entry, record))
}

/**
 * Whether every row in `inner` sits inside `outer`. Used when a Module Admin
 * gives scopes: they may give only what they hold themselves. A null ("all")
 * row is inside `outer` only when `outer` is also "all" on that dimension.
 */
export function scopeContains(outer: ResolvedScope, inner: readonly ScopeEntry[]): boolean {
	if (outer.nationwide) return true
	return inner.every(row =>
		outer.entries.some(
			held =>
				(held.serviceCategoryId === null || held.serviceCategoryId === row.serviceCategoryId) &&
				(held.locationId === null || held.locationId === row.locationId)
		)
	)
}

/**
 * Whether the Scope reaches every value of one dimension: nationwide, or a row
 * with that column null. Creating a new Location (or a new Service Category's
 * service) needs this, because the new record is in nobody's Scope yet.
 */
export function coversAll(scope: ResolvedScope, dimension: keyof ScopeEntry): boolean {
	if (scope.nationwide) return true
	return scope.entries.some(entry => entry[dimension] === null)
}

/**
 * Whether a scoped admin may see and manage another user (ADM-2): the other
 * user must be scoped (not nationwide), have at least one Scope row, and
 * every row must sit inside the admin's own Scope.
 */
export function userWithinScope(
	actor: ResolvedScope,
	target: Pick<ResolvedPermissionSet, "roleNames" | "scopes">
): boolean {
	if (actor.nationwide) return true
	if (toResolvedScope(target).nationwide) return false
	return target.scopes.length > 0 && scopeContains(actor, target.scopes)
}

/**
 * A WHERE condition limiting a query to the user's Scope.
 *
 * - `undefined`: no limit (nationwide, or a row covering everything these columns can say).
 * - `false`: the user has no Scope rows, so the query returns nothing.
 * - otherwise one OR branch per Scope row.
 */
export function scopeCondition(scope: ResolvedScope, columns: ScopeColumns): SQL | undefined {
	if (scope.nationwide) return undefined

	const branches: SQL[] = []
	for (const entry of scope.entries) {
		const parts: SQL[] = []
		if (columns.serviceCategoryId && entry.serviceCategoryId !== null) {
			parts.push(eq(columns.serviceCategoryId, entry.serviceCategoryId))
		}
		if (columns.locationId && entry.locationId !== null) {
			parts.push(eq(columns.locationId, entry.locationId))
		}
		// This row limits nothing these columns can express, so it allows every row.
		if (parts.length === 0) return undefined
		branches.push(and(...parts) as SQL)
	}

	if (branches.length === 0) return sql`false`
	return or(...branches) as SQL
}
