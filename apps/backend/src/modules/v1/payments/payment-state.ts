import type { PaymentStatus } from "@repo/contracts"

/**
 * Payment state machine (DOMAIN-MODEL.md section 5.3).
 *
 *  initiated ──► pending ──► succeeded ──► refunded
 *                   ├──► failed
 *                   └──► expired
 *
 * `succeeded` is terminal for money in. A success reported by the provider
 * after the Payment was marked failed or expired still wins: the money
 * arrived, so it is recorded (and reviewed if the Booking can no longer be
 * paid). Only `PaymentService` changes a Payment's status.
 */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
	initiated: ["pending", "failed", "succeeded"],
	pending: ["succeeded", "failed", "expired"],
	failed: ["succeeded"],
	expired: ["succeeded"],
	succeeded: ["refunded"],
	refunded: [],
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
	return TRANSITIONS[from].includes(to)
}
