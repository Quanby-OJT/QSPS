import { eq } from "drizzle-orm"

import { normalizeSmsNumber, smsDestinationKey } from "@repo/auth/sms"
import { bookings, notifications, users } from "@repo/db/schema"

import type { Transaction } from "@/modules/v1/bookings/bookings.service"

export type NotificationTemplate =
	| "booking_confirmed"
	| "payment_received"
	| "payment_received_review"
	| "payment_duplicate_review"
	| "booking_cancelled"
	| "booking_rescheduled"
	| "expedite_decision"
	| "assessment_returned"
	| "assessment_rejected"
	| "document_ready"

/**
 * Events that also go out by SMS (NTF-2), with the text sent. The message is
 * this text plus the Reference Number, and nothing else personal.
 */
export const SMS_EVENT_TEXT: Partial<Record<NotificationTemplate, string>> = {
	booking_confirmed: "Booking confirmed",
	payment_received: "Payment received",
	booking_cancelled: "Booking cancelled",
}

/**
 * The notification outbox (NTF-1, DOMAIN-MODEL.md `notifications`).
 *
 * `enqueue` runs inside the caller's transaction, so a change that rolls back
 * queues nothing. The recipient is the Booking's client (record ownership; no
 * permission key). `dedupe_key` is channel, recipient, template and event id,
 * so enqueuing the same event twice queues one message. Only the outbox worker
 * changes `status`. NTF-2: an SMS is queued beside the email for the events in
 * `SMS_EVENT_TEXT` when the client has a verified number and SMS turned on.
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
				mobile: users.mobile,
				mobileVerifiedAt: users.mobileVerifiedAt,
				smsEnabled: users.smsNotificationsEnabled,
			})
			.from(bookings)
			.innerJoin(users, eq(bookings.clientId, users.id))
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

		const mobile = booking.mobile ? normalizeSmsNumber(booking.mobile) : null
		if (
			booking.smsEnabled &&
			booking.mobileVerifiedAt &&
			mobile &&
			SMS_EVENT_TEXT[template] !== undefined
		) {
			await tx
				.insert(notifications)
				.values({
					userId: booking.userId,
					channel: "sms",
					template,
					payload: {
						bookingId,
						referenceNumber: booking.referenceNumber,
						destinationKey: smsDestinationKey(process.env.BETTER_AUTH_SECRET ?? "", mobile),
					},
					dedupeKey: JSON.stringify(["sms", booking.userId, template, eventId]),
				})
				.onConflictDoNothing({ target: notifications.dedupeKey })
		}
	}
}
