import { Logger } from "@nestjs/common"
import { ORPCError } from "@orpc/server"

import { AUDIT_DOMAIN_RBAC, type AuditService } from "@/common/audit/audit.service"

/** The record a Scope check is about, for the audit entry and the 404. */
export interface ScopeTarget {
	/** Kind of record, e.g. "booking", "schedule_slot", "user". */
	type: string
	id: string | number
	/** The same message a missing record gets, so the 404 reveals nothing. */
	notFoundMessage: string
}

const logger = new Logger("ScopeService")

/**
 * Records an attempt on a record outside the caller's Scope as a denied
 * audit entry, then throws the same 404 a missing record gets. Services that
 * already hold an `AuditService` call this directly with a Scope the
 * controller resolved.
 *
 * Same rule as the RBAC guard: a failed audit write is logged, and the
 * denial still stands.
 */
export async function denyOutsideScope(
	auditService: AuditService,
	actorId: string | null,
	target: ScopeTarget,
	record?: unknown
): Promise<never> {
	try {
		await auditService.record({
			domain: AUDIT_DOMAIN_RBAC,
			action: "scope.check",
			outcome: "denied",
			actorId,
			targetType: target.type,
			targetId: String(target.id),
			newValue: record === undefined ? null : { record },
			reason: "outside scope",
		})
	} catch (error) {
		logger.error({
			event: "scope.denied.audit_failed",
			actorId,
			targetType: target.type,
			error: error instanceof Error ? error.message : String(error),
		})
	}
	throw new ORPCError("NOT_FOUND", { message: target.notFoundMessage })
}
