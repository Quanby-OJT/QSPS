import type { BookingItemStatus } from "@repo/contracts"

/**
 * Booking Item state machine (DOMAIN-MODEL.md section 5.2).
 *
 *  booked ─► checked_in ─► in_assessment ─► cleared ─► issued
 *    │                        │   ▲   └──► pending_head_approval (Service requires_approval)
 *    ▼                        ▼   │
 *  no_show                 returned        rejected (from in_assessment)
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
	// Head approval and override are PRC-3; the arrows are here so it only
	// needs to call BookingService.
	pending_head_approval: ["cleared", "rejected"],
	cleared: ["issued"],
	issued: [],
	rejected: [],
	no_show: [],
}

/** Whether a Booking Item may move from one status to another. */
export function canTransitionItem(from: BookingItemStatus, to: BookingItemStatus): boolean {
	return ITEM_TRANSITIONS[from].includes(to)
}

/** The item statuses that can never change again. */
export function isTerminalItem(status: BookingItemStatus): boolean {
	return ITEM_TRANSITIONS[status].length === 0
}
