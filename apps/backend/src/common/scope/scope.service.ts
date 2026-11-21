import { Injectable, Logger } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import type { SQL } from "drizzle-orm"

import { AUDIT_DOMAIN_RBAC, AuditService } from "@/common/audit/audit.service"
import { RbacService } from "@/common/rbac/rbac.service"

import {
	inScope,
	scopeCondition,
	toResolvedScope,
	type ResolvedScope,
	type ScopeColumns,
	type ScopedRecord,
} from "./scope-match"

/** The record a Scope check is about, for the audit entry and the 404. */
export interface ScopeTarget {
	/** Kind of record, e.g. "booking", "schedule_slot", "user". */
	type: string
	id: string | number
	/** The same message a missing record gets, so the 404 reveals nothing. */
	notFoundMessage: string
}

/**
 * Limits staff to their Service Categories and Locations (ADM-2, Flow A
 * step 2). Every staff-facing list adds {@link filter} to its WHERE clause,
 * and every staff-facing read or change by ID calls {@link assert} first.
 *
 * Scope is read through `RbacService`, so it shares the permission cache and
 * is dropped by the same `RbacCacheService.invalidate`.
 */
@Injectable()
export class ScopeService {
	private readonly logger = new Logger(ScopeService.name)

	constructor(
		private readonly rbacService: RbacService,
		private readonly auditService: AuditService
	) {}

	async resolve(userId: string): Promise<ResolvedScope> {
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

		await this.recordDenial(userId, target, records)
		throw new ORPCError("NOT_FOUND", { message: target.notFoundMessage })
	}

	/** Same rule as the RBAC guard: a failed audit write is logged, and the denial still stands. */
	private async recordDenial(
		userId: string,
		target: ScopeTarget,
		records: readonly ScopedRecord[]
	): Promise<void> {
		try {
			await this.auditService.record({
				domain: AUDIT_DOMAIN_RBAC,
				action: "scope.check",
				outcome: "denied",
				actorId: userId,
				targetType: target.type,
				targetId: String(target.id),
				newValue: { record: records },
				reason: "outside scope",
			})
		} catch (error) {
			this.logger.error({
				event: "scope.denied.audit_failed",
				actorId: userId,
				targetType: target.type,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
}
