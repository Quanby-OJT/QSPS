import { Injectable, Logger } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import { and, asc, eq, not, or, sql } from "drizzle-orm"

import { bookingItems, bookings, payments, scheduleSlots } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { PolicyService } from "@/common/policy/policy.service"
import {
	expiryReason,
	IN_FLIGHT_PAYMENT_STATUSES,
	PAYMENT_IN_FLIGHT_MINUTES,
} from "@/modules/v1/bookings/booking-expiry"
import { BookingService } from "@/modules/v1/bookings/bookings.service"

const MS_PER_MINUTE = 60_000

/** The most Bookings one run cancels; the rest wait for the next minute. */
const BATCH_SIZE = 100

export interface BookingExpiryResult {
	holdExpired: number
	noShow: number
	failed: number
}

/**
 * Cancels unpaid Bookings that no longer hold their place (BKG-2, Flow B
 * steps 4 to 6). Annex B: an unpaid booking is cancelled after the hold, and
 * a missed arrival cutoff cancels it.
 *
 * Every minute, in one transaction, it picks `pending_payment` Bookings whose
 * hold has passed (online only) or whose earliest slot starts within
 * `booking.arrival_cutoff_minutes`, skipping any with a Payment still in
 * flight. The rows are taken `FOR UPDATE SKIP LOCKED`, so a second run at the
 * same time (another instance, or an overlapping tick) skips them instead of
 * cancelling them again. Each Booking is cancelled through
 * `BookingService.cancel` in its own savepoint, so one bad row does not undo
 * the rest. System action: the audit entries have no actor.
 */
@Injectable()
export class BookingExpiryService {
	private readonly logger = new Logger(BookingExpiryService.name)

	constructor(
		private readonly bookingService: BookingService,
		private readonly policyService: PolicyService
	) {}

	@Cron(CronExpression.EVERY_MINUTE, { name: "booking-expiry" })
	async run(): Promise<void> {
		// A cron callback has no caller: a throw here must be logged, not left
		// as an unhandled rejection. The next tick tries again.
		try {
			const result = await this.expireDue()
			if (result.holdExpired || result.noShow || result.failed) {
				this.logger.log({ event: "bookings.expiry", ...result })
			}
		} catch (error) {
			this.logger.error(
				"Booking expiry run failed",
				error instanceof Error ? error.stack : undefined
			)
		}
	}

	async expireDue(now: Date = new Date(), batchSize = BATCH_SIZE): Promise<BookingExpiryResult> {
		const cutoffMinutes = await this.policyService.get("booking.arrival_cutoff_minutes")

		// Raw SQL gets ISO text, not Date objects: the driver would send a Date
		// in the server's local time zone, and the columns hold UTC.
		const nowIso = now.toISOString()
		const cutoffIso = new Date(now.getTime() + cutoffMinutes * MS_PER_MINUTE).toISOString()
		const inFlightSinceIso = new Date(
			now.getTime() - PAYMENT_IN_FLIGHT_MINUTES * MS_PER_MINUTE
		).toISOString()
		const inFlightStatuses = sql.join(
			IN_FLIGHT_PAYMENT_STATUSES.map(status => sql`${status}`),
			sql`, `
		)

		const holdExpiredSql = sql<boolean>`(${bookings.payOnsite} = false and ${bookings.holdExpiresAt} is not null and ${bookings.holdExpiresAt} <= ${nowIso})`
		const pastArrivalCutoffSql = sql<boolean>`exists (select 1 from ${bookingItems} inner join ${scheduleSlots} on ${scheduleSlots.id} = ${bookingItems.scheduleSlotId} where ${bookingItems.bookingId} = ${bookings.id} and ${scheduleSlots.startsAt} <= ${cutoffIso})`
		const paymentInFlight = sql<boolean>`exists (select 1 from ${payments} where ${payments.bookingId} = ${bookings.id} and ${payments.status} in (${inFlightStatuses}) and ${payments.createdAt} > ${inFlightSinceIso})`

		return db.transaction(async tx => {
			const due = await tx
				// Plain columns only: drizzle writes the columns inside a raw SQL
				// expression unqualified in a select list, which Postgres finds ambiguous.
				.select({
					id: bookings.id,
					payOnsite: bookings.payOnsite,
					holdExpiresAt: bookings.holdExpiresAt,
				})
				.from(bookings)
				.where(
					and(
						eq(bookings.status, "pending_payment"),
						or(holdExpiredSql, pastArrivalCutoffSql),
						not(paymentInFlight)
					)
				)
				.orderBy(asc(bookings.id))
				.limit(batchSize)
				.for("update", { skipLocked: true })

			const result: BookingExpiryResult = { holdExpired: 0, noShow: 0, failed: 0 }
			for (const row of due) {
				// Picked by the filter above, so whatever is not a passed hold is a
				// passed arrival cutoff.
				const holdExpired =
					!row.payOnsite &&
					row.holdExpiresAt !== null &&
					row.holdExpiresAt.getTime() <= now.getTime()
				const reason = expiryReason({ holdExpired, pastArrivalCutoff: !holdExpired })
				if (!reason) continue
				try {
					const cancelled = await tx.transaction(savepoint =>
						this.bookingService.cancel(savepoint, row.id, reason, { actorId: null, now })
					)
					if (!cancelled) continue
					if (reason === "hold_expired") result.holdExpired++
					else result.noShow++
				} catch (error) {
					result.failed++
					this.logger.error({
						event: "bookings.expiry.failed",
						bookingId: row.id,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}
			return result
		})
	}
}
