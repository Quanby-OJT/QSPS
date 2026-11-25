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

/** Names staff see for each document type (CRT-1, CRT-3, CRT-5). An unknown type shows as stored. */
const DOCUMENT_TYPE_LABELS: Record<string, string> = {
	"pe-medical-certificate": "Physical Examination Medical Certificate",
	"icv-record": "International Certificate of Vaccination",
	"medical-exemption": "Medical Exemption Certificate",
	"sanitary-permit": "Sanitary Permit",
	"ship-sanitation": "Ship Sanitation Certificate",
	// CRT-6
	"food-safety-training": "Food Safety Training Certificate",
	"haccp": "HACCP Certificate",
}

export function documentTypeLabel(type: string): string {
	return DOCUMENT_TYPE_LABELS[type] ?? type
}

/** "Not printed yet" / "Printed once" / "Printed 3 times" (CRT-3). */
export function printCountLabel(printCount: number): string {
	if (printCount <= 0) return "Not printed yet"
	if (printCount === 1) return "Printed once"
	return `Printed ${printCount} times`
}

/**
 * CRT-3: whether a vaccination Service, so an exempt client can get a
 * Medical Exemption Certificate instead. Same list as
 * `VACCINATION_DOCUMENT_TYPES` in @repo/contracts.
 */
export function allowsExemption(serviceDocumentType: string | null): boolean {
	return serviceDocumentType === "icv-record"
}

/** CRT-5: the documents an officer issues by hand, each with a validity period. */
export type SanitationDocumentType = "sanitary-permit" | "ship-sanitation"

/**
 * CRT-5: the sanitation document a Service issues, or null for any other
 * Service. Such a Service never auto-issues: the officer enters the validity
 * period (and, for a ship, the findings) when issuing.
 */
export function sanitationDocumentType(
	serviceDocumentType: string | null
): SanitationDocumentType | null {
	return serviceDocumentType === "sanitary-permit" || serviceDocumentType === "ship-sanitation"
		? serviceDocumentType
		: null
}

/**
 * CRT-6: the documents an officer issues by hand with a validity period: the
 * two sanitation documents and the HACCP Certificate.
 */
export type ValidityDocumentType = SanitationDocumentType | "haccp"

export function validityDocumentType(
	serviceDocumentType: string | null
): ValidityDocumentType | null {
	return serviceDocumentType === "haccp" ? "haccp" : sanitationDocumentType(serviceDocumentType)
}

/**
 * CRT-6: whether a Service is a seminar. Its Food Safety Training Certificate
 * is issued to the whole session from the seminar roster, not from one item.
 */
export function isSeminarService(serviceDocumentType: string | null): boolean {
	return serviceDocumentType === "food-safety-training"
}

/**
 * CRT-1, CRT-3: a cleared item whose Service issues a document but has none
 * yet (auto-issue off, or cleared after head approval) is issued from the item.
 */
export function needsIssuing(item: {
	status: BookingItemStatus
	service: { documentType: string | null }
	document: unknown
}): boolean {
	return item.status === "cleared" && item.service.documentType !== null && item.document === null
}

/**
 * PRC-4: the names of the active required steps with no result yet, in
 * order. The item can be cleared only when this is empty; the API checks the
 * same rule.
 */
export function pendingRequiredSteps(
	steps: readonly { name: string; required: boolean; status: "pending" | "done" }[]
): string[] {
	return steps.filter(step => step.required && step.status === "pending").map(step => step.name)
}
