import type { AssessmentKind, AssessmentOutcome, BookingItemStatus } from "@repo/contracts"

const ITEM_STATUS_LABELS: Record<BookingItemStatus, string> = {
	booked: "Booked",
	checked_in: "Checked in",
	in_assessment: "In assessment",
	returned: "Returned for correction",
	cleared: "Cleared",
	pending_head_approval: "Awaiting head approval",
	issued: "Issued",
	rejected: "Rejected",
	no_show: "No show",
}

/** Plain words for a Booking Item status (state machine 5.2). */
export function itemStatusLabel(status: BookingItemStatus): string {
	return ITEM_STATUS_LABELS[status]
}

const OUTCOME_LABELS: Record<AssessmentOutcome, string> = {
	cleared: "Cleared",
	returned: "Returned for correction",
	rejected: "Rejected",
}

/**
 * Plain words for one history entry. PRC-3: a head's approval or override
 * reads differently from the officer's own assessment.
 */
export function outcomeLabel(
	outcome: AssessmentOutcome,
	kind: AssessmentKind = "assessment"
): string {
	if (kind === "approval") return outcome === "cleared" ? "Approved by head" : "Sent back by head"
	if (kind === "override") return "Overridden to cleared"
	return OUTCOME_LABELS[outcome]
}

/** PRC-3: a head may approve or send back an item in this status. */
export function canDecideApproval(status: BookingItemStatus): boolean {
	return status === "pending_head_approval"
}

/** PRC-3: a head may override an item in this status to cleared. */
export function canOverride(status: BookingItemStatus): boolean {
	return status === "rejected"
}

/** Staff may open an item for assessment from these statuses. */
export function canOpen(status: BookingItemStatus): boolean {
	return status === "checked_in" || status === "returned"
}

/**
 * Turns the correction rows on the form into the map the API stores: blank
 * rows are dropped, names and values are trimmed, and a repeated field name
 * keeps its last value.
 */
export function correctionsFromRows(
	rows: readonly { field: string; value: string }[]
): Record<string, string> {
	const corrections: Record<string, string> = {}
	for (const row of rows) {
		const field = row.field.trim()
		if (field) corrections[field] = row.value.trim()
	}
	return corrections
}
