import type { BookingItemStatus } from "@repo/contracts"

/**
 * Booking Item state machine (DOMAIN-MODEL.md section 5.2).
 *
 *  booked ─► checked_in ─► in_assessment ─► cleared ─► issued
 *    │                        │   ▲   └──► pending_head_approval (Service requires_approval)
 *    ▼                        ▼   │
 *  no_show                 returned        rejected (from in_assessment)
 *
 *  pending_head_approval ─► cleared (approve) · in_assessment (send back)
 *  rejected ─► cleared, by approver override only ({@link canOverrideItem})
 *
 * Only `BookingService` changes an item's status, and only along these arrows.
 * `checked_in` also needs the parent Booking to be `paid`; that guard is in
 * `BookingService.checkInItems`, because it reads another row.
 */
const ITEM_TRANSITIONS: Record<BookingItemStatus, readonly BookingItemStatus[]> = {
	booked: ["checked_in", "no_show"],
	checked_in: ["in_assessment"],
	in_assessment: ["cleared", "pending_head_approval", "returned", "rejected"],
	// The client corrects what was wrong, then staff open the item again.
	returned: ["in_assessment"],
	// PRC-3: the head approves (cleared) or sends the item back to the
	// officer (in_assessment). `rejected` stays for a later head rejection.
	pending_head_approval: ["cleared", "in_assessment", "rejected"],
	cleared: ["issued"],
	issued: [],
	rejected: [],
	no_show: [],
}

/**
 * Moves only an approver may force (PRC-3): clearing a rejected item with a
 * mandatory reason. Kept apart from {@link ITEM_TRANSITIONS} so `rejected`
 * still counts as final when a Booking is completed.
 */
const ITEM_OVERRIDES: Partial<Record<BookingItemStatus, readonly BookingItemStatus[]>> = {
	rejected: ["cleared"],
}

/** Whether an approver may override a Booking Item from one status to another. */
export function canOverrideItem(from: BookingItemStatus, to: BookingItemStatus): boolean {
	return ITEM_OVERRIDES[from]?.includes(to) ?? false
}

/** Whether a Booking Item may move from one status to another. */
export function canTransitionItem(from: BookingItemStatus, to: BookingItemStatus): boolean {
	return ITEM_TRANSITIONS[from].includes(to)
}

/** The item statuses that can never change again. */
export function isTerminalItem(status: BookingItemStatus): boolean {
	return ITEM_TRANSITIONS[status].length === 0
}
