import { eq } from "drizzle-orm"

import { bookings, notifications } from "@repo/db/schema"

import type { Transaction } from "@/modules/v1/bookings/bookings.service"

export type NotificationTemplate =
	| "booking_confirmed"
	| "payment_received"
	| "booking_cancelled"
	| "booking_rescheduled"
	| "expedite_decision"
	| "assessment_returned"
	| "assessment_rejected"
	| "document_ready"

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
