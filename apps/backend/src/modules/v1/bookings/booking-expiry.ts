import type { Booking } from "@repo/contracts"

/** Why a Booking was cancelled (BKG-2). */
export type BookingCancelReason = NonNullable<Booking["cancelReason"]>

/**
 * How long a Payment that is still `initiated` or `pending` keeps its Booking
 * from being cancelled (BKG-2). The provider may still confirm it. After this,
 * the Booking expires as usual; a confirmation that arrives later is a late
 * payment, flagged for review (PAY-6 adds the provider re-check).
 */
export const PAYMENT_IN_FLIGHT_MINUTES = 60

/** Payment statuses that may still become `succeeded` on their own. */
export const IN_FLIGHT_PAYMENT_STATUSES = ["initiated", "pending"] as const

/**
 * Why the expiry job cancels a due Booking. A passed hold wins over a passed
 * arrival cutoff, so an online Booking whose hold ran out says so even when
 * its slot is also about to start.
 */
export function expiryReason(due: {
	holdExpired: boolean
	pastArrivalCutoff: boolean
}): Extract<BookingCancelReason, "hold_expired" | "no_show"> | null {
	if (due.holdExpired) return "hold_expired"
	if (due.pastArrivalCutoff) return "no_show"
	return null
}
