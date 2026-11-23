import { eq } from "drizzle-orm"

import { bookings, notifications } from "@repo/db/schema"

import type { Transaction } from "@/modules/v1/bookings/bookings.service"

export type NotificationTemplate =
	| "booking_confirmed"
	| "payment_received"
	| "payment_received_review"
	| "booking_cancelled"
	| "booking_rescheduled"
	| "expedite_decision"
	| "assessment_returned"
	| "assessment_rejected"
	| "document_ready"

/**
 * The notification outbox (NTF-1, DOMAIN-MODEL.md `notifications`).
 *
 * `enqueue` runs inside the caller's transaction, so a change that rolls back
 * queues nothing. The recipient is the Booking's client (record ownership; no
 * permission key). `dedupe_key` is channel, recipient, template and event id,
 * so enqueuing the same event twice queues one message. Only the outbox worker
 * changes `status`.
 */
export class NotificationService {
	static async enqueue(
		tx: Transaction,
		bookingId: number,
		template: NotificationTemplate,
		eventId: string,
		payload: Record<string, unknown> = {}
	): Promise<void> {
		const [booking] = await tx
			.select({
				userId: bookings.clientId,
				referenceNumber: bookings.referenceNumber,
			})
			.from(bookings)
			.where(eq(bookings.id, bookingId))

		if (!booking) {
			throw new Error("Notification booking not found")
		}

		await tx
			.insert(notifications)
			.values({
				userId: booking.userId,
				channel: "email",
				template,
				payload: {
					...payload,
					bookingId,
					referenceNumber: booking.referenceNumber,
				},
				dedupeKey: JSON.stringify(["email", booking.userId, template, eventId]),
			})
			.onConflictDoNothing({
				target: notifications.dedupeKey,
			})
	}
}
