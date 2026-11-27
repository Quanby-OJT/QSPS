import type { AuditLogEntry, AuditLogFilter, AuditOutcome } from "@repo/contracts"

/** Entries per page; the API allows up to 200. */
export const AUDIT_PAGE_SIZE = 50

/** What the filter form holds: plain strings, so every input stays controlled. */
export interface AuditFilterDraft {
	from: string
	to: string
	actor: string
	role: string
	domain: string
	action: string
	outcome: AuditOutcome | "all"
	targetType: string
	targetId: string
}

export const EMPTY_AUDIT_DRAFT: AuditFilterDraft = {
	from: "",
	to: "",
	actor: "",
	role: "",
	domain: "",
	action: "",
	outcome: "all",
	targetType: "",
	targetId: "",
}

/** The form's values as API filters: trimmed, with empty fields left out. */
export function draftToFilter(draft: AuditFilterDraft): AuditLogFilter {
	const filter: AuditLogFilter = {}
	const text = (value: string) => {
		const trimmed = value.trim()
		return trimmed.length > 0 ? trimmed : undefined
	}

	filter.from = text(draft.from)
	filter.to = text(draft.to)
	filter.actor = text(draft.actor)
	filter.role = text(draft.role)
	filter.domain = text(draft.domain)
	filter.action = text(draft.action)
	filter.targetType = text(draft.targetType)
	filter.targetId = text(draft.targetId)
	if (draft.outcome !== "all") filter.outcome = draft.outcome

	for (const key of Object.keys(filter) as (keyof AuditLogFilter)[]) {
		if (filter[key] === undefined) delete filter[key]
	}
	return filter
}

/** A date range that ends before it starts. Dates are YYYY-MM-DD, so text order is date order. */
export function rangeIsBackwards(filter: AuditLogFilter): boolean {
	return Boolean(filter.from && filter.to && filter.from > filter.to)
}

export function auditQueryString(params: Record<string, string | number | undefined>): string {
	const search = new URLSearchParams()
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") search.set(key, String(value))
	}
	const text = search.toString()
	return text ? `?${text}` : ""
}

/** Who acted: their email, else their user id, else the System. */
export function actorLabel(entry: Pick<AuditLogEntry, "actorEmail" | "actorId">): string {
	return entry.actorEmail ?? entry.actorId ?? "System"
}

export function targetLabel(entry: Pick<AuditLogEntry, "targetType" | "targetId">): string {
	if (!entry.targetType) return "—"
	return entry.targetId ? `${entry.targetType}: ${entry.targetId}` : entry.targetType
}

/** Old and new values for display: text as it is, anything else as indented JSON. */
export function formatAuditValue(value: unknown): string {
	if (value === null || value === undefined) return "—"
	if (typeof value === "string") return value
	try {
		return JSON.stringify(value, null, 2)
	} catch {
		return String(value)
	}
}

const whenFormatter = new Intl.DateTimeFormat("en-PH", {
	timeZone: "Asia/Manila",
	dateStyle: "medium",
	timeStyle: "medium",
})

/** Shown in Manila time, the business timezone. */
export function formatAuditTime(date: Date): string {
	return whenFormatter.format(date)
}
