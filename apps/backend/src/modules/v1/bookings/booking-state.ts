import type { BookingKind, BookingStatus, ClientBookingStatus } from "@repo/contracts"

import type { BookingCancelReason } from "./booking-expiry"

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
const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
	pending_approval: ["pending_payment", "rejected"],
	pending_payment: ["paid", "cancelled"],
	paid: ["completed", "forfeited", "refund_requested"],
	completed: [],
	cancelled: [],
	rejected: [],
	forfeited: [],
	refund_requested: ["refunded"],
	refunded: [],
}

export class InvalidBookingTransitionError extends Error {
	constructor(from: BookingStatus, to: BookingStatus) {
		super(`Invalid booking transition from "${from}" to "${to}"`)
		this.name = "InvalidBookingTransitionError"
	}
}

export function initialStatus(kind: BookingKind): BookingStatus {
	return kind === "regular" || kind === "walk-in" ? "pending_payment" : "pending_approval"
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
	return TRANSITIONS[from].includes(to)
}

export const canTransitionBooking = canTransition

export type BookingTransitionPatch =
	| { to: "paid"; holdExpiresAt: null }
	| {
			to: "cancelled"
			cancelReason: BookingCancelReason
			cancelledAt: Date
			holdExpiresAt: null
	  }
	| { to: Exclude<BookingStatus, "paid" | "cancelled"> }

export function applyBookingTransition(
	from: BookingStatus,
	patch: BookingTransitionPatch
): {
	status: BookingStatus
	holdExpiresAt?: null
	cancelReason?: BookingCancelReason
	cancelledAt?: Date
} {
	if (!canTransitionBooking(from, patch.to)) {
		throw new InvalidBookingTransitionError(from, patch.to)
	}

	if (patch.to === "paid") {
		return { status: "paid", holdExpiresAt: patch.holdExpiresAt }
	}
	if (patch.to === "cancelled") {
		return {
			status: "cancelled",
			cancelReason: patch.cancelReason,
			cancelledAt: patch.cancelledAt,
			holdExpiresAt: patch.holdExpiresAt,
		}
	}
	return { status: patch.to }
}

export function bookingHoldsCapacity(status: BookingStatus): boolean {
	return status === "pending_approval" || status === "pending_payment" || status === "paid"
}

/**
 * Maps an internal BookingStatus to the client-facing status label shown in
 * "My Transactions" and Booking details (BKG-4, DOMAIN-MODEL.md section 5.1):
 * - Pending: pending_approval, pending_payment
 * - Paid: paid, completed
 * - Cancelled: cancelled, rejected, forfeited, refund_requested, refunded
 */
export function toClientBookingStatus(status: BookingStatus): ClientBookingStatus {
	switch (status) {
		case "pending_approval":
		case "pending_payment":
			return "Pending"
		case "paid":
		case "completed":
			return "Paid"
		case "cancelled":
		case "rejected":
		case "forfeited":
		case "refund_requested":
		case "refunded":
			return "Cancelled"
	}
}