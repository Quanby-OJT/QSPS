import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { BookingService } from "./bookings.service"
import { generateReferenceNumber } from "./reference-number"

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
		transaction: jest.fn(),
	},
}))

// The hold comes from env until the hold Policy is editable (ADM-6).
jest.mock("@/config/env.config", () => ({
	env: { BOOKING_HOLD_MINUTES: 60 },
}))

jest.mock("./reference-number", () => ({
	generateReferenceNumber: jest.fn(),
}))

/** Tuesday 17 November 2026, 15:00 in Manila. */
const NOW = new Date("2026-11-17T07:00:00.000Z")

const makeSlot = (overrides: Record<string, unknown> = {}) => ({
	id: 7,
	serviceId: 1,
	locationId: 2,
	startsAt: new Date("2026-12-02T00:00:00.000Z"),
	endsAt: new Date("2026-12-02T04:00:00.000Z"),
	capacity: 20,
	bookedCount: 19,
	isDisabled: false,
	createdAt: NOW,
	updatedAt: NOW,
	...overrides,
})

const service = { id: 1, name: "Yellow fever vaccination", feeCentavos: 150000, isActive: true }
const location = { id: 2, name: "Manila", isActive: true }

const savedBooking = {
	id: 31,
	referenceNumber: "QSPS-261117-AB12CD",
	clientId: "client-1",
	status: "pending_payment",
	kind: "regular",
	totalCentavos: 150000,
	holdExpiresAt: new Date("2026-11-17T08:00:00.000Z"),
	createdBy: "client-1",
	createdAt: NOW,
	updatedAt: NOW,
}

const savedItem = {
	id: 44,
	bookingId: 31,
	serviceId: 1,
	scheduleSlotId: 7,
	locationId: 2,
	feeCentavos: 150000,
	status: "booked",
	createdAt: NOW,
	updatedAt: NOW,
}

/**
 * A query that resolves to `rows` however it is finished: awaited directly,
 * or ended with `.limit()` or `.for("update")`. `lock` records the lock mode.
 */
function query(rows: unknown[], lock?: jest.Mock) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		where: () => chain,
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

interface Scenario {
	unpaid?: unknown[]
	slot?: unknown[]
	service?: unknown[]
	location?: unknown[]
	/** One entry per Reference Number check: a row means "already taken". */
	referenceChecks?: unknown[][]
}

/** Wires a transaction that answers the service's queries in the order it asks them. */
function mockBookingTransaction(scenario: Scenario = {}) {
	const clientLock = jest.fn()
	const slotLock = jest.fn()
	const select = jest
		.fn()
		.mockReturnValueOnce(query([{ id: "client-1" }], clientLock))
		.mockReturnValueOnce(query(scenario.unpaid ?? []))
		.mockReturnValueOnce(query(scenario.slot ?? [makeSlot()], slotLock))
		.mockReturnValueOnce(query(scenario.service ?? [service]))
		.mockReturnValueOnce(query(scenario.location ?? [location]))
	for (const rows of scenario.referenceChecks ?? [[]]) {
		select.mockReturnValueOnce(query(rows))
	}

	const bookingValues = jest.fn()
	const itemValues = jest.fn()
	const insert = jest
		.fn()
		.mockReturnValueOnce({
			values: (values: unknown) => {
				bookingValues(values)
				return { returning: () => Promise.resolve([savedBooking]) }
			},
		})
		.mockReturnValueOnce({
			values: (values: unknown) => {
				itemValues(values)
				return { returning: () => Promise.resolve([savedItem]) }
			},
		})

	const slotSet = jest.fn()
	const update = jest.fn().mockReturnValue({
		set: (values: unknown) => {
			slotSet(values)
			return { where: () => Promise.resolve(undefined) }
		},
	})

	const tx = { select, insert, update }
	jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
	return { tx, clientLock, slotLock, insert, update, bookingValues, itemValues, slotSet }
}

describe("BookingService.create", () => {
	let bookingService: BookingService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		jest.mocked(generateReferenceNumber).mockReturnValue("QSPS-261117-AB12CD")
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = new BookingService(auditService as unknown as AuditService)
	})

	it("creates a pending_payment booking with one item and a Reference Number", async () => {
		const { bookingValues, itemValues } = mockBookingTransaction()

		const booking = await bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)

		expect(booking).toMatchObject({
			id: 31,
			referenceNumber: "QSPS-261117-AB12CD",
			status: "pending_payment",
			kind: "regular",
			totalCentavos: 150000,
		})
		expect(booking.items).toEqual([
			{
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
			},
		])
		expect(bookingValues).toHaveBeenCalledWith(
			expect.objectContaining({
				referenceNumber: "QSPS-261117-AB12CD",
				clientId: "client-1",
				createdBy: "client-1",
				status: "pending_payment",
				kind: "regular",
				totalCentavos: 150000,
			})
		)
		expect(itemValues).toHaveBeenCalledWith({
			bookingId: 31,
			serviceId: 1,
			scheduleSlotId: 7,
			locationId: 2,
			feeCentavos: 150000,
			status: "booked",
		})
	})

	it("sets hold_expires_at from the hold setting: 60 minutes after booking", async () => {
		const { bookingValues } = mockBookingTransaction()

		await bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)

		expect(bookingValues).toHaveBeenCalledWith(
			expect.objectContaining({ holdExpiresAt: new Date("2026-11-17T08:00:00.000Z") })
		)
	})

	it("locks the slot row before reading capacity, then raises booked_count by one", async () => {
		const { slotLock, update, slotSet } = mockBookingTransaction()

		await bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)

		// Flow B: SELECT … FOR UPDATE is what makes two clients take turns.
		expect(slotLock).toHaveBeenCalledWith("update")
		expect(update).toHaveBeenCalledTimes(1)
		// The new count is computed by the database (booked_count + 1), not sent
		// as a number read earlier, so a concurrent booking cannot be overwritten.
		const { bookedCount } = slotSet.mock.calls[0]?.[0] as { bookedCount: unknown }
		expect(typeof bookedCount).toBe("object")
		expect(bookedCount).not.toBe(20)
	})

	it("writes one audit entry in the same transaction", async () => {
		const { tx } = mockBookingTransaction()

		await bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)

		expect(auditService.record).toHaveBeenCalledTimes(1)
		expect(auditService.record).toHaveBeenCalledWith(
			{
				domain: "bookings",
				action: "booking.create",
				actorId: "client-1",
				targetType: "booking",
				targetId: "31",
				oldValue: null,
				newValue: {
					id: 31,
					referenceNumber: "QSPS-261117-AB12CD",
					clientId: "client-1",
					status: "pending_payment",
					kind: "regular",
					totalCentavos: 150000,
					holdExpiresAt: "2026-11-17T08:00:00.000Z",
					items: [
						{
							id: 44,
							serviceId: 1,
							scheduleSlotId: 7,
							locationId: 2,
							feeCentavos: 150000,
							status: "booked",
						},
					],
				},
			},
			tx
		)
	})

	it("tells the second of two clients the slot is full once the last place is taken", async () => {
		// What the second request sees after waiting for the first one's lock.
		const { insert, update } = mockBookingTransaction({
			slot: [makeSlot({ capacity: 20, bookedCount: 20 })],
		})

		await expect(
			bookingService.create({ scheduleSlotId: 7 }, "client-2", NOW)
		).rejects.toMatchObject({ code: "CONFLICT", message: "This slot is full" })
		expect(insert).not.toHaveBeenCalled()
		expect(update).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("refuses a disabled slot", async () => {
		const { insert, update } = mockBookingTransaction({
			slot: [makeSlot({ isDisabled: true, bookedCount: 0 })],
		})

		await expect(
			bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)
		).rejects.toMatchObject({ code: "CONFLICT", message: "This slot is no longer available" })
		expect(insert).not.toHaveBeenCalled()
		expect(update).not.toHaveBeenCalled()
	})

	it("refuses a slot that has already started", async () => {
		const { insert } = mockBookingTransaction({
			slot: [makeSlot({ startsAt: new Date("2026-11-17T06:00:00.000Z"), bookedCount: 0 })],
		})

		await expect(
			bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)
		).rejects.toMatchObject({ code: "CONFLICT", message: "This slot has already started" })
		expect(insert).not.toHaveBeenCalled()
	})

	it("refuses a slot whose service or location has been disabled", async () => {
		mockBookingTransaction({ service: [{ ...service, isActive: false }] })
		await expect(
			bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)
		).rejects.toMatchObject({ code: "CONFLICT" })

		mockBookingTransaction({ location: [{ ...location, isActive: false }] })
		await expect(
			bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("returns not found for an unknown slot", async () => {
		mockBookingTransaction({ slot: [] })

		await expect(
			bookingService.create({ scheduleSlotId: 99 }, "client-1", NOW)
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})

	it("refuses a client who already has an unpaid booking, under a lock on their own row", async () => {
		const { clientLock, insert } = mockBookingTransaction({
			unpaid: [{ referenceNumber: "QSPS-261116-ZZ99ZZ" }],
		})

		await expect(
			bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: expect.stringContaining("QSPS-261116-ZZ99ZZ"),
		})
		expect(clientLock).toHaveBeenCalledWith("update")
		expect(insert).not.toHaveBeenCalled()
	})

	it("draws a new Reference Number when the first one is already in use", async () => {
		jest
			.mocked(generateReferenceNumber)
			.mockReturnValueOnce("QSPS-261117-TAKEN2")
			.mockReturnValueOnce("QSPS-261117-FREE22")
		const { bookingValues } = mockBookingTransaction({ referenceChecks: [[{ id: 5 }], []] })

		await bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)

		expect(generateReferenceNumber).toHaveBeenCalledTimes(2)
		expect(bookingValues).toHaveBeenCalledWith(
			expect.objectContaining({ referenceNumber: "QSPS-261117-FREE22" })
		)
	})

	it("gives up with a clear error when every Reference Number drawn is taken", async () => {
		const { insert } = mockBookingTransaction({
			referenceChecks: Array.from({ length: 5 }, () => [{ id: 5 }]),
		})

		await expect(
			bookingService.create({ scheduleSlotId: 7 }, "client-1", NOW)
		).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" })
		expect(insert).not.toHaveBeenCalled()
	})

	it("refuses a request with no signed-in user before opening a transaction", async () => {
		await expect(bookingService.create({ scheduleSlotId: 7 }, null, NOW)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
		expect(db.transaction).not.toHaveBeenCalled()
	})
})
