import type { BookingKind, BookingStatus } from "@repo/contracts"

/**
 * Booking state machine (DOMAIN-MODEL.md section 5.1).
 *
 *                     ┌── rejected
 *  pending_approval ──┤                        (expedite only)
 *                     └─► pending_payment ─► paid ─► completed
 *                              │              ├─► forfeited
 *                              ▼              └─► refund_requested ─► refunded
 *                          cancelled
 *
 * Only `BookingService` changes a Booking's status, and only along these arrows.
 */
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
	pending_approval: ["pending_payment", "rejected"],
	pending_payment: ["paid", "cancelled"],
	paid: ["completed", "forfeited", "refund_requested"],
	refund_requested: ["refunded"],
	completed: [],
	cancelled: [],
	rejected: [],
	forfeited: [],
	refunded: [],
}

/** Whether a Booking may move from one status to another. */
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
	return TRANSITIONS[from].includes(to)
}

/** The statuses a Booking can never leave. */
export function isTerminal(status: BookingStatus): boolean {
	return TRANSITIONS[status].length === 0
}

/**
 * The status a new Booking starts in. An expedite request waits for staff
 * approval; every other kind goes straight to awaiting payment.
 */
export function initialStatus(kind: BookingKind): BookingStatus {
	return kind === "expedite" ? "pending_approval" : "pending_payment"
}
