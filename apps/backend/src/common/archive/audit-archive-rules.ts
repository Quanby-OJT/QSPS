import type { ArchivedAuditLogEntry, AuditLogFilter, AuditOutcome } from "@repo/contracts"

import type { ChainedRow } from "@/common/audit/audit-chain"

/** One audit_log row as an archive file holds it: JSON, camelCase, dates as ISO text. */
export interface ArchivedAuditRow {
	id: number
	domain: string
	action: string
	outcome: string
	actorId: string | null
	actorRole: string | null
	targetType: string | null
	targetId: string | null
	oldValue: unknown
	newValue: unknown
	reason: string | null
	ipAddress: string | null
	userAgent: string | null
	prevHash: string | null
	entryHash: string | null
	createdAt: string
}

/** The row in the shape the hash chain checks, so archived rows verify like live ones. */
export function toChainedRow(row: ArchivedAuditRow): ChainedRow {
	return { ...row, createdAt: new Date(row.createdAt) }
}

export function toArchivedEntry(
	row: ArchivedAuditRow,
	actorEmail: string | null
): ArchivedAuditLogEntry {
	return {
		id: row.id,
		domain: row.domain,
		action: row.action,
		outcome: row.outcome as AuditOutcome,
		actorId: row.actorId,
		actorEmail,
		actorRole: row.actorRole,
		targetType: row.targetType,
		targetId: row.targetId,
		oldValue: row.oldValue ?? null,
		newValue: row.newValue ?? null,
		reason: row.reason,
		ipAddress: row.ipAddress,
		userAgent: row.userAgent,
		prevHash: row.prevHash,
		entryHash: row.entryHash,
		createdAt: new Date(row.createdAt),
		archived: true,
	}
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Manila is UTC+8 all year, as in the live search (ADM-3). */
function manilaDayStart(date: string): Date {
	return new Date(`${date}T00:00:00+08:00`)
}

/** The instants the filter's Manila dates cover: from (included) and the start of the day after `to`. */
export function auditFilterRange(filter: AuditLogFilter): {
	from: Date | null
	toExclusive: Date | null
} {
	return {
		from: filter.from ? manilaDayStart(filter.from) : null,
		toExclusive: filter.to ? new Date(manilaDayStart(filter.to).getTime() + DAY_MS) : null,
	}
}

function includesText(value: string | null, needle: string): boolean {
	return value !== null && value.toLowerCase().includes(needle.toLowerCase())
}

/** The ADM-3 filters, applied to an archived entry exactly as the live search applies them. */
export function matchesAuditFilter(entry: ArchivedAuditLogEntry, filter: AuditLogFilter): boolean {
	const { from, toExclusive } = auditFilterRange(filter)
	const at = entry.createdAt.getTime()
	if (from && at < from.getTime()) return false
	if (toExclusive && at >= toExclusive.getTime()) return false

	if (filter.actor) {
		if (filter.actor.toLowerCase() === "system") {
			if (entry.actorId !== null) return false
		} else if (entry.actorId !== filter.actor && !includesText(entry.actorEmail, filter.actor)) {
			return false
		}
	}
	if (filter.role && !includesText(entry.actorRole, filter.role)) return false
	if (filter.domain && entry.domain !== filter.domain) return false
	if (filter.action && !entry.action.toLowerCase().startsWith(filter.action.toLowerCase())) {
		return false
	}
	if (filter.outcome && entry.outcome !== filter.outcome) return false
	if (filter.targetType && entry.targetType !== filter.targetType) return false
	if (filter.targetId && entry.targetId !== filter.targetId) return false
	return true
}
