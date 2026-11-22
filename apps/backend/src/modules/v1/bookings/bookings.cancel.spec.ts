import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import type { PolicyService } from "@/common/policy/policy.service"

import { BookingService } from "./bookings.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options: { message: string }
		) {
			super(options.message)
		}
	},
}))

jest.mock("@/common/database/database.client", () => ({
	db: {
		select: jest.fn(),
		transaction: jest.fn(),
	},
}))

jest.mock("@/common/policy/policy.service", () => ({
	PolicyService: jest.fn(),
}))

const NOW = new Date("2026-11-22T07:00:00.000Z")

/**
 * A query that resolves to `rows` however it is finished: awaited directly,
 * or ended with `.limit()` or `.for("update")`. `lock` records the lock mode.
 */
function query(rows: unknown[], lock?: jest.Mock) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		innerJoin: () => chain,
		where: () => chain,
		orderBy: () => chain,
		limit: () => Promise.resolve(rows),
		for: (mode: string) => {
			lock?.(mode)
			return Promise.resolve(rows)
		},
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

/** A transaction whose selects answer in order; records every lock and every update. */
function transaction(selects: unknown[][]) {
	const locks = jest.fn()
	const sets = jest.fn()
	const select = jest.fn()
	for (const rows of selects) select.mockReturnValueOnce(query(rows, locks))
	const update = jest.fn().mockReturnValue({
		set: (values: unknown) => {
			sets(values)
			return { where: () => Promise.resolve(undefined) }
		},
	})
	const tx = { select, update }
	return { tx, locks, sets, update }
}

const storedBooking = {
	id: 31,
	referenceNumber: "QSPS-261122-AB12CD",
	clientId: "client-1",
	status: "cancelled",
	kind: "regular",
	totalCentavos: 150000,
	holdExpiresAt: null,
	payOnsite: false,
	cancelReason: "client_cancelled",
	cancelledAt: NOW,
	createdBy: "client-1",
	createdAt: NOW,
	updatedAt: NOW,
}

const storedItem = {
	id: 44,
	serviceId: 1,
	serviceName: "Yellow fever vaccination",
	locationId: 2,
	locationName: "Manila",
	scheduleSlotId: 7,
	startsAt: new Date("2026-12-02T00:00:00.000Z"),
	endsAt: new Date("2026-12-02T04:00:00.000Z"),
	feeCentavos: 150000,
	status: "booked",
}

/** Answers the read of the Booking after it changed (`loadBooking`). */
function mockLoad(booking: Record<string, unknown> = storedBooking) {
	jest
		.mocked(db.select)
		.mockReturnValueOnce(query([booking]) as never)
		.mockReturnValueOnce(query([storedItem]) as never)
}

describe("BookingService cancelling (BKG-2)", () => {
	let bookingService: BookingService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		// resetAllMocks: the mockReturnValueOnce queues must not leak between tests.
		jest.resetAllMocks()
		jest.spyOn(NotificationService, "enqueue").mockResolvedValue(undefined)
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = new BookingService(
			auditService as unknown as AuditService,
			{ get: jest.fn() } as unknown as PolicyService
		)
	})

	describe("cancel", () => {
		it("locks the booking, cancels it with the reason and frees one place per item", async () => {
			const { tx, locks, sets } = transaction([
				[{ id: 31, status: "pending_payment" }],
				[
					{ id: 44, scheduleSlotId: 7 },
					{ id: 45, scheduleSlotId: 9 },
				],
			])

			await expect(
				bookingService.cancel(tx as never, 31, "hold_expired", { actorId: null, now: NOW })
			).resolves.toBe(true)

			expect(locks).toHaveBeenCalledWith("update")
			expect(sets).toHaveBeenNthCalledWith(1, {
				status: "cancelled",
				cancelReason: "hold_expired",
				cancelledAt: NOW,
				holdExpiresAt: null,
				updatedAt: NOW,
			})
			// Two slot updates, each computed by the database, not a number read earlier.
			expect(sets).toHaveBeenCalledTimes(3)
			const slotSet = sets.mock.calls[1]?.[0] as { bookedCount: unknown }
			expect(typeof slotSet.bookedCount).not.toBe("number")
		})

		it("audits a System cancellation with no actor, under the job's domain", async () => {
			const { tx } = transaction([
				[{ id: 31, status: "pending_payment" }],
				[{ id: 44, scheduleSlotId: 7 }],
			])

			await bookingService.cancel(tx as never, 31, "no_show", { actorId: null, now: NOW })

			expect(auditService.record).toHaveBeenCalledWith(
				{
					domain: "booking-expiry",
					action: "booking.cancelled",
					actorId: null,
					targetType: "booking",
					targetId: "31",
					oldValue: { status: "pending_payment" },
					newValue: { status: "cancelled", cancelReason: "no_show", releasedScheduleSlotIds: [7] },
				},
				tx
			)
		})

		it("audits a client cancellation under the client and the bookings domain", async () => {
			const { tx } = transaction([
				[{ id: 31, status: "pending_payment" }],
				[{ id: 44, scheduleSlotId: 7 }],
			])

			await bookingService.cancel(tx as never, 31, "client_cancelled", {
				actorId: "client-1",
				now: NOW,
			})

			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({ domain: "bookings", actorId: "client-1" }),
				tx
			)
		})

		it.each(["cancelled", "paid", "completed"])(
			"changes nothing and frees nothing when the booking is already %s",
			async status => {
				const { tx, sets } = transaction([[{ id: 31, status }]])

				await expect(
					bookingService.cancel(tx as never, 31, "hold_expired", { actorId: null, now: NOW })
				).resolves.toBe(false)
				expect(sets).not.toHaveBeenCalled()
				expect(auditService.record).not.toHaveBeenCalled()
			}
		)

		it("fails when the booking does not exist", async () => {
			const { tx } = transaction([[]])

			await expect(
				bookingService.cancel(tx as never, 99, "hold_expired", { actorId: null, now: NOW })
			).rejects.toMatchObject({ code: "NOT_FOUND" })
		})
	})

	describe("cancelOwn", () => {
		function mockTransaction(selects: unknown[][]) {
			const wired = transaction(selects)
			jest
				.mocked(db.transaction)
				.mockImplementation(callback => callback(wired.tx as never) as never)
			return wired
		}

		it("cancels the client's own unpaid booking as client_cancelled and returns it", async () => {
			const { sets } = mockTransaction([
				[{ clientId: "client-1", status: "pending_payment" }],
				[],
				[{ id: 31, status: "pending_payment" }],
				[{ id: 44, scheduleSlotId: 7 }],
			])
			mockLoad()

			const booking = await bookingService.cancelOwn(31, "client-1", NOW)

			expect(sets).toHaveBeenCalledWith(
				expect.objectContaining({ status: "cancelled", cancelReason: "client_cancelled" })
			)
			expect(booking).toMatchObject({
				id: 31,
				status: "cancelled",
				cancelReason: "client_cancelled",
				items: [storedItem],
			})
		})

		it("answers someone else's booking like a missing one and audits the denial", async () => {
			const { sets } = mockTransaction([[{ clientId: "client-2", status: "pending_payment" }]])

			await expect(bookingService.cancelOwn(31, "client-1", NOW)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(sets).not.toHaveBeenCalled()
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "booking.cancel",
					outcome: "denied",
					actorId: "client-1",
					targetId: "31",
					reason: "not_owner",
				})
			)
		})

		it("audits a missing booking as not_found", async () => {
			mockTransaction([[]])

			await expect(bookingService.cancelOwn(99, "client-1", NOW)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", reason: "not_found" })
			)
		})

		it("refuses a booking that is not awaiting payment", async () => {
			mockTransaction([[{ clientId: "client-1", status: "paid" }]])

			await expect(bookingService.cancelOwn(31, "client-1", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
			})
		})

		it("refuses while a payment for it is still being processed", async () => {
			const { sets } = mockTransaction([
				[{ clientId: "client-1", status: "pending_payment" }],
				[{ id: 5 }],
			])

			await expect(bookingService.cancelOwn(31, "client-1", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
				message: expect.stringContaining("still being processed"),
			})
			expect(sets).not.toHaveBeenCalled()
		})

		it("needs a signed-in client", async () => {
			await expect(bookingService.cancelOwn(31, null, NOW)).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			})
		})
	})

	describe("choosePayOnsite", () => {
		function mockTransaction(selects: unknown[][]) {
			const wired = transaction(selects)
			jest
				.mocked(db.transaction)
				.mockImplementation(callback => callback(wired.tx as never) as never)
			return wired
		}

		it("marks the booking paid onsite and clears the hold, with an audit entry", async () => {
			const hold = new Date("2026-11-22T08:00:00.000Z")
			const { sets, tx } = mockTransaction([
				[
					{
						clientId: "client-1",
						status: "pending_payment",
						payOnsite: false,
						holdExpiresAt: hold,
					},
				],
			])
			mockLoad({ ...storedBooking, status: "pending_payment", payOnsite: true, cancelReason: null })

			const booking = await bookingService.choosePayOnsite(31, "client-1", NOW)

			expect(sets).toHaveBeenCalledWith({ payOnsite: true, holdExpiresAt: null, updatedAt: NOW })
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "booking.pay_onsite",
					actorId: "client-1",
					oldValue: { payOnsite: false, holdExpiresAt: hold.toISOString() },
					newValue: { payOnsite: true, holdExpiresAt: null },
				}),
				tx
			)
			expect(booking.payOnsite).toBe(true)
		})

		it("changes nothing when onsite payment was already chosen", async () => {
			const { sets } = mockTransaction([
				[{ clientId: "client-1", status: "pending_payment", payOnsite: true, holdExpiresAt: null }],
			])
			mockLoad({ ...storedBooking, status: "pending_payment", payOnsite: true })

			await bookingService.choosePayOnsite(31, "client-1", NOW)

			expect(sets).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		})

		it("refuses a booking that is not awaiting payment", async () => {
			mockTransaction([
				[{ clientId: "client-1", status: "cancelled", payOnsite: false, holdExpiresAt: null }],
			])

			await expect(bookingService.choosePayOnsite(31, "client-1", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
			})
		})

		it("answers someone else's booking like a missing one", async () => {
			mockTransaction([
				[
					{
						clientId: "client-2",
						status: "pending_payment",
						payOnsite: false,
						holdExpiresAt: null,
					},
				],
			])

			await expect(bookingService.choosePayOnsite(31, "client-1", NOW)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "booking.pay_onsite", outcome: "denied" })
			)
		})
	})

	describe("findUnpaid", () => {
		it("returns null when the client has no booking awaiting payment", async () => {
			jest.mocked(db.select).mockReturnValueOnce(query([]) as never)

			await expect(bookingService.findUnpaid("client-1")).resolves.toBeNull()
		})

		it("returns the booking awaiting payment with its items", async () => {
			jest.mocked(db.select).mockReturnValueOnce(query([{ id: 31 }]) as never)
			mockLoad({
				...storedBooking,
				status: "pending_payment",
				cancelReason: null,
				cancelledAt: null,
			})

			await expect(bookingService.findUnpaid("client-1")).resolves.toMatchObject({
				id: 31,
				referenceNumber: "QSPS-261122-AB12CD",
				status: "pending_payment",
				items: [storedItem],
			})
		})
	})
})
