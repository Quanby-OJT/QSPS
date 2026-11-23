import { eq, inArray } from "drizzle-orm"

import { bookings, notifications, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { bindDbBackedTests } from "@/testing/db-ready"

import { NotificationService } from "./notification.service"

/**
 * The notification outbox (NTF-1) against a real database.
 *
 * The transactional part (nothing queued when the caller rolls back) and the
 * unique `dedupe_key` can only be shown on Postgres. Skips when no Postgres is
 * reachable or the tables are missing, like the other database specs.
 */
describe("NotificationService.enqueue (NTF-1)", () => {
	const marker = `ntf1-${process.pid}`
	const userId = `${marker}-client`
	const bookingIds: number[] = []
	let referenceCounter = 0

	const dbTests = bindDbBackedTests({
		label: "ntf1",
		relations: ["users", "bookings", "notifications"],
		database: db,
	})
	const itDb = dbTests.itDb

	beforeAll(async () => {
		await dbTests.probe()
		if (!dbTests.ready) return
		await db.insert(users).values({
			id: userId,
			name: "NTF-1 test client",
			email: `${marker}@example.test`,
		})
	})

	afterEach(async () => {
		if (!dbTests.ready) return
		await db.delete(notifications).where(eq(notifications.userId, userId))
		if (bookingIds.length) {
			await db.delete(bookings).where(inArray(bookings.id, bookingIds))
			bookingIds.length = 0
		}
	})

	afterAll(async () => {
		if (dbTests.ready) await db.delete(users).where(eq(users.id, userId))
		if (dbTests.connected) await db.$client.end()
	})

	/** One unpaid Booking owned by the test client. */
	async function makeBooking(): Promise<{ id: number; referenceNumber: string }> {
		const suffix = `${process.pid % 1000}${referenceCounter++}`.padStart(6, "0").slice(-6)
		const referenceNumber = `QSPS-010102-${suffix}`
		const [booking] = await db
			.insert(bookings)
			.values({
				referenceNumber,
				clientId: userId,
				status: "pending_payment",
				kind: "regular",
				totalCentavos: 10000,
				holdExpiresAt: null,
				createdBy: userId,
			})
			.returning({ id: bookings.id })
		if (!booking) throw new Error("Expected a booking")
		bookingIds.push(booking.id)
		return { id: booking.id, referenceNumber }
	}

	async function queued() {
		return db.select().from(notifications).where(eq(notifications.userId, userId))
	}

	itDb("queues one email to the booking's client with the reference number", async () => {
		const booking = await makeBooking()

		await db.transaction(tx =>
			NotificationService.enqueue(tx, booking.id, "payment_received", "event-1", { paymentId: 5 })
		)

		const rows = await queued()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			userId,
			channel: "email",
			template: "payment_received",
			status: "queued",
			attempts: 0,
			payload: { paymentId: 5, bookingId: booking.id, referenceNumber: booking.referenceNumber },
		})
	})

	itDb("queues the same event once, even when enqueued twice", async () => {
		const booking = await makeBooking()

		await db.transaction(async tx => {
			await NotificationService.enqueue(tx, booking.id, "booking_confirmed", "same-event")
			await NotificationService.enqueue(tx, booking.id, "booking_confirmed", "same-event")
		})
		await db.transaction(tx =>
			NotificationService.enqueue(tx, booking.id, "booking_confirmed", "same-event")
		)

		expect(await queued()).toHaveLength(1)
	})

	itDb("queues separate messages for separate events", async () => {
		const booking = await makeBooking()

		await db.transaction(async tx => {
			await NotificationService.enqueue(tx, booking.id, "booking_confirmed", "event-a")
			await NotificationService.enqueue(tx, booking.id, "booking_cancelled", "event-b")
		})

		expect((await queued()).map(row => row.template).sort()).toEqual([
			"booking_cancelled",
			"booking_confirmed",
		])
	})

	itDb("queues nothing when the caller's transaction rolls back", async () => {
		const booking = await makeBooking()

		await expect(
			db.transaction(async tx => {
				await NotificationService.enqueue(tx, booking.id, "booking_cancelled", "rollback-event")
				throw new Error("rollback")
			})
		).rejects.toThrow("rollback")

		expect(await queued()).toHaveLength(0)
	})

	itDb("makes a new row due now, by the application's clock", async () => {
		const booking = await makeBooking()
		const before = Date.now()

		await db.transaction(tx =>
			NotificationService.enqueue(tx, booking.id, "document_ready", "due-event")
		)

		// The database clock fills next_attempt_at; the worker compares it with
		// the application clock and runs every minute. A time-zone mix-up would
		// be hours off, so anything within a minute is due on the next run.
		const [row] = await queued()
		if (!row) throw new Error("Expected a queued row")
		expect(Math.abs(row.nextAttemptAt.getTime() - before)).toBeLessThan(60_000)
	})

	itDb("refuses a booking that does not exist", async () => {
		await expect(
			db.transaction(tx =>
				NotificationService.enqueue(tx, -1, "booking_confirmed", "missing-booking")
			)
		).rejects.toThrow("Notification booking not found")
	})
})
