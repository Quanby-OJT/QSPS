import { Injectable } from "@nestjs/common"
import type { SQL } from "drizzle-orm"

import { AuditService } from "@/common/audit/audit.service"
import { RbacService } from "@/common/rbac/rbac.service"

import { denyOutsideScope, type ScopeTarget } from "./scope-denial"
import {
	inScope,
	scopeCondition,
	toResolvedScope,
	type ResolvedScope,
	type ScopeColumns,
	type ScopedRecord,
} from "./scope-match"
import type { ScopeResolver } from "./scope.token"

export type { ScopeTarget } from "./scope-denial"

/**
 * Limits staff to their Service Categories and Locations (ADM-2, Flow A
 * step 2). Every staff-facing list adds {@link filter} to its WHERE clause,
 * and every staff-facing read or change by ID calls {@link assert} first.
 *
 * Scope is read through `RbacService`, so it shares the permission cache and
 * is dropped by the same `RbacCacheService.invalidate`.
 */
@Injectable()
export class ScopeService implements ScopeResolver {
	constructor(
		private readonly rbacService: RbacService,
		private readonly auditService: AuditService
	) {}

	/** The caller's Scope. No user (no session) means no Scope at all. */
	async resolve(userId: string | null): Promise<ResolvedScope> {
		if (!userId) return { nationwide: false, entries: [] }
		return toResolvedScope(await this.rbacService.getResolvedAccess(userId))
	}

	/**
	 * A condition to AND into a staff-facing list query. `undefined` means no
	 * limit. Pass only the columns the query has.
	 */
	async filter(userId: string, columns: ScopeColumns): Promise<SQL | undefined> {
		return scopeCondition(await this.resolve(userId), columns)
	}

	/**
	 * Refuses a record outside the user's Scope with the same 404 a missing
	 * record gets, and records the attempt as a denied audit entry.
	 *
	 * Pass several records when the target spans them (a Booking's items): it
	 * is allowed when any one is in Scope.
	 */
	async assert(
		userId: string,
		record: ScopedRecord | readonly ScopedRecord[],
		target: ScopeTarget
	): Promise<void> {
		const scope = await this.resolve(userId)
		const records: readonly ScopedRecord[] = Array.isArray(record)
			? record
			: [record as ScopedRecord]
		if (records.some(entry => inScope(scope, entry))) return

		await denyOutsideScope(this.auditService, userId, target, records)
	}
}
