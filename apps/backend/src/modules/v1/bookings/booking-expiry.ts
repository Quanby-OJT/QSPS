import type { Booking } from "@repo/contracts"

/** Why a Booking was cancelled (BKG-2). */
export type BookingCancelReason = NonNullable<Booking["cancelReason"]>

/**
 * How long a Payment that is still `initiated` or `pending` keeps its Booking
 * from being cancelled after the Payment last moved (BKG-2). The provider may
 * still confirm it.
 *
 * PAY-6 deferral rule: each time the re-query job asks the provider and the
 * answer is still "pending", it touches the Payment's `updated_at`, so the
 * Booking keeps waiting for as long as the provider says the payment is open
 * (an over-the-counter 7-Eleven payment, say), up to
 * `PAYMENT_DEFERRAL_MAX_HOURS` after the Payment started. If the provider
 * cannot be reached, nothing touches it and the Booking expires after this
 * many minutes, as before. A confirmation that arrives after expiry is a
 * late payment, flagged for review.
 */
export const PAYMENT_IN_FLIGHT_MINUTES = 60

/** The longest a pending Payment can keep its Booking from expiring (PAY-6). */
export const PAYMENT_DEFERRAL_MAX_HOURS = 24

/**
 * How long a Payment may stay `pending` without hearing from the provider
 * before the re-query job asks the provider itself (PAY-6), and how often it
 * asks again after that.
 */
export const PAYMENT_REQUERY_MINUTES = 10

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
