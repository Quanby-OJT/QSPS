import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import type { PolicyService } from "@/common/policy/policy.service"

import { BookingService } from "./bookings.service"
import { generateReferenceNumber } from "./reference-number"

beforeEach(() => jest.spyOn(NotificationService, "enqueue").mockResolvedValue(undefined))
afterEach(() => jest.restoreAllMocks())

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

// ADM-6: the hold comes from PolicyService; the real one needs the database and Redis.
jest.mock("@/common/policy/policy.service", () => ({
	PolicyService: jest.fn(),
}))

jest.mock("./reference-number", () => ({
	generateReferenceNumber: jest.fn(),
}))

/** Tuesday 17 November 2026, 15:00 in Manila. */
const NOW = new Date("2026-11-17T07:00:00.000Z")

/** A PolicyService that answers `booking.hold_minutes` with `holdMinutes`. */
function policies(holdMinutes = 60) {
	return { get: jest.fn().mockResolvedValue(holdMinutes) }
}

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

/** BKG-3: a second Service, booked at another Location in the same checkout. */
const seminarSlot = makeSlot({
	id: 9,
	serviceId: 3,
	locationId: 4,
	startsAt: new Date("2026-12-03T01:00:00.000Z"),
	endsAt: new Date("2026-12-03T03:00:00.000Z"),
	bookedCount: 0,
})
const seminar = { id: 3, name: "Basic hygiene seminar", feeCentavos: 50000, isActive: true }
const cebu = { id: 4, name: "Cebu", isActive: true }

const savedBooking = {
	id: 31,
	referenceNumber: "QSPS-261117-AB12CD",
	clientId: "client-1",
	status: "pending_payment",
	kind: "regular",
	totalCentavos: 150000,
	holdExpiresAt: new Date("2026-11-17T08:00:00.000Z"),
	payOnsite: false,
	cancelReason: null,
	cancelledAt: null,
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

const savedSeminarItem = {
	...savedItem,
	id: 45,
	serviceId: 3,
	scheduleSlotId: 9,
	locationId: 4,
	feeCentavos: 50000,
}

/**
 * A query that resolves to `rows` however it is finished: awaited directly,
 * or ended with `.limit()` or `.for("update")`. `lock` records the lock mode;
 * `trace` records the order of `orderBy` and `for` calls.
 */
function query(rows: unknown[], lock?: jest.Mock, trace?: jest.Mock) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		where: () => chain,
		orderBy: () => {
			trace?.("orderBy")
			return chain
		},
		limit: () => Promise.resolve(rows),
		for: (mode: string) => {
			lock?.(mode)
			trace?.(`for ${mode}`)
			return Promise.resolve(rows)
		},
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

/** A stored policy version (ADM-9). */
const makePolicy = (overrides: Record<string, unknown> = {}) => ({
	id: 4,
	documentKey: "key-terms",
	version: 2,
	title: "Terms of booking",
	body: "Arrive 15 minutes early.",
	appliesToAllServices: true,
	serviceIds: [],
	effectiveFrom: "2026-11-01",
	requiresAcceptance: true,
	withdrawnAt: null,
	createdBy: "admin-1",
	createdAt: NOW,
	...overrides,
})

interface Scenario {
	unpaid?: unknown[]
	/** The locked slot rows, as the database returns them (ascending id). */
	slots?: unknown[]
	services?: unknown[]
	locations?: unknown[]
	/** Stored policy versions not withdrawn and already effective (ADM-9). */
	policies?: unknown[]
	/** One entry per Reference Number check: a row means "already taken". */
	referenceChecks?: unknown[][]
	savedBooking?: unknown
	savedItems?: unknown[]
}

/** Wires a transaction that answers the service's queries in the order it asks them. */
function mockBookingTransaction(scenario: Scenario = {}) {
	const clientLock = jest.fn()
	const slotLock = jest.fn()
	const slotTrace = jest.fn()
	const select = jest
		.fn()
		.mockReturnValueOnce(query([{ id: "client-1" }], clientLock))
		.mockReturnValueOnce(query(scenario.unpaid ?? []))
		.mockReturnValueOnce(query(scenario.slots ?? [makeSlot()], slotLock, slotTrace))
		.mockReturnValueOnce(query(scenario.services ?? [service]))
		.mockReturnValueOnce(query(scenario.locations ?? [location]))
		.mockReturnValueOnce(query(scenario.policies ?? []))
	for (const rows of scenario.referenceChecks ?? [[]]) {
		select.mockReturnValueOnce(query(rows))
	}

	const bookingValues = jest.fn()
	const itemValues = jest.fn()
	const acceptanceValues = jest.fn()
	const insert = jest
		.fn()
		.mockReturnValueOnce({
			values: (values: unknown) => {
				bookingValues(values)
				return { returning: () => Promise.resolve([scenario.savedBooking ?? savedBooking]) }
			},
		})
		.mockReturnValueOnce({
			values: (values: unknown) => {
				itemValues(values)
				return { returning: () => Promise.resolve(scenario.savedItems ?? [savedItem]) }
			},
		})
		.mockReturnValueOnce({
			values: (values: unknown) => {
				acceptanceValues(values)
				return Promise.resolve(undefined)
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
	return {
		tx,
		clientLock,
		slotLock,
		slotTrace,
		insert,
		update,
		bookingValues,
		itemValues,
		acceptanceValues,
		slotSet,
	}
}

/** BKG-3: a checkout of the vaccination in Manila and the seminar in Cebu. */
function mockTwoServiceTransaction(scenario: Scenario = {}) {
	return mockBookingTransaction({
		slots: [makeSlot(), seminarSlot],
		services: [service, seminar],
		locations: [location, cebu],
		savedBooking: { ...savedBooking, totalCentavos: 200000 },
		savedItems: [savedItem, savedSeminarItem],
		...scenario,
	})
}

/** The input for booking slot 7 alone. */
const oneSlot = (acceptedPolicyDocumentIds: number[] = []) => ({
	items: [{ scheduleSlotId: 7 }],
	acceptedPolicyDocumentIds,
})

/** The input for booking slots 7 and 9 together (BKG-3). */
const twoSlots = (acceptedPolicyDocumentIds: number[] = []) => ({
	items: [{ scheduleSlotId: 7 }, { scheduleSlotId: 9 }],
	acceptedPolicyDocumentIds,
})

describe("BookingService.create", () => {
	let bookingService: BookingService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		jest.mocked(generateReferenceNumber).mockReturnValue("QSPS-261117-AB12CD")
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = new BookingService(
			auditService as unknown as AuditService,
			policies() as unknown as PolicyService
		)
	})

	it("creates a pending_payment booking with one item and a Reference Number", async () => {
		const { bookingValues, itemValues } = mockBookingTransaction()

		const booking = await bookingService.create(oneSlot(), "client-1", NOW)

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
		expect(itemValues).toHaveBeenCalledWith([
			{
				bookingId: 31,
				serviceId: 1,
				scheduleSlotId: 7,
				locationId: 2,
				feeCentavos: 150000,
				status: "booked",
			},
		])
	})

	it("books two Services in one checkout: one Booking, two items, the total is their sum (BKG-3)", async () => {
		const { bookingValues, itemValues, update } = mockTwoServiceTransaction()

		const booking = await bookingService.create(twoSlots(), "client-1", NOW)

		expect(bookingValues).toHaveBeenCalledTimes(1)
		expect(bookingValues).toHaveBeenCalledWith(expect.objectContaining({ totalCentavos: 200000 }))
		expect(itemValues).toHaveBeenCalledWith([
			{
				bookingId: 31,
				serviceId: 1,
				scheduleSlotId: 7,
				locationId: 2,
				feeCentavos: 150000,
				status: "booked",
			},
			{
				bookingId: 31,
				serviceId: 3,
				scheduleSlotId: 9,
				locationId: 4,
				feeCentavos: 50000,
				status: "booked",
			},
		])
		expect(booking.totalCentavos).toBe(200000)
		expect(booking.items).toEqual([
			expect.objectContaining({
				id: 44,
				serviceName: "Yellow fever vaccination",
				locationName: "Manila",
				feeCentavos: 150000,
			}),
			expect.objectContaining({
				id: 45,
				serviceName: "Basic hygiene seminar",
				locationName: "Cebu",
				scheduleSlotId: 9,
				startsAt: new Date("2026-12-03T01:00:00.000Z"),
				feeCentavos: 50000,
			}),
		])
		// Both slots' counts rise in one statement on the rows locked earlier.
		expect(update).toHaveBeenCalledTimes(1)
	})

	it("returns the items in item id order, whatever order the database returns them in", async () => {
		mockTwoServiceTransaction({ savedItems: [savedSeminarItem, savedItem] })

		const booking = await bookingService.create(twoSlots(), "client-1", NOW)

		expect(booking.items.map(item => item.id)).toEqual([44, 45])
	})

	it("locks every slot in one statement, ordered by slot id, before reading any capacity", async () => {
		const { slotLock, slotTrace } = mockTwoServiceTransaction()

		// The client chose the seminar first; the lock order is still by slot id.
		await bookingService.create(
			{ items: [{ scheduleSlotId: 9 }, { scheduleSlotId: 7 }], acceptedPolicyDocumentIds: [] },
			"client-1",
			NOW
		)

		// Flow B: SELECT … ORDER BY id FOR UPDATE, so two checkouts sharing slots
		// always lock them in the same order and cannot deadlock.
		expect(slotLock).toHaveBeenCalledTimes(1)
		expect(slotTrace.mock.calls.map(call => call[0])).toEqual(["orderBy", "for update"])
	})

	it("sets hold_expires_at from the hold Policy: 60 minutes after booking by default", async () => {
		const { bookingValues } = mockBookingTransaction()

		await bookingService.create(oneSlot(), "client-1", NOW)

		expect(bookingValues).toHaveBeenCalledWith(
			expect.objectContaining({ holdExpiresAt: new Date("2026-11-17T08:00:00.000Z") })
		)
	})

	it("uses a changed hold Policy for the next booking (ADM-6)", async () => {
		const policyService = policies(90)
		bookingService = new BookingService(
			auditService as unknown as AuditService,
			policyService as unknown as PolicyService
		)
		const { bookingValues } = mockBookingTransaction()

		await bookingService.create(oneSlot(), "client-1", NOW)

		expect(policyService.get).toHaveBeenCalledWith("booking.hold_minutes")
		expect(bookingValues).toHaveBeenCalledWith(
			expect.objectContaining({ holdExpiresAt: new Date("2026-11-17T08:30:00.000Z") })
		)
	})

	it("locks the slot row before reading capacity, then raises booked_count by one", async () => {
		const { slotLock, update, slotSet } = mockBookingTransaction()

		await bookingService.create(oneSlot(), "client-1", NOW)

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

		await bookingService.create(oneSlot(), "client-1", NOW)

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
					acceptedPolicies: [],
				},
			},
			tx
		)
	})

	it("audits every item of a multi-service checkout in its one entry (BKG-3)", async () => {
		const { tx } = mockTwoServiceTransaction()

		await bookingService.create(twoSlots(), "client-1", NOW)

		expect(auditService.record).toHaveBeenCalledTimes(1)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "booking.create",
				newValue: expect.objectContaining({
					totalCentavos: 200000,
					items: [
						expect.objectContaining({ id: 44, scheduleSlotId: 7, feeCentavos: 150000 }),
						expect.objectContaining({ id: 45, scheduleSlotId: 9, feeCentavos: 50000 }),
					],
				}),
			}),
			tx
		)
	})

	it("creates nothing when one slot of the checkout filled up, and names that Service (BKG-3)", async () => {
		// The seminar's last place went to someone else while this client reviewed.
		const { insert, update } = mockTwoServiceTransaction({
			slots: [makeSlot(), { ...seminarSlot, capacity: 30, bookedCount: 30 }],
		})

		await expect(bookingService.create(twoSlots(), "client-1", NOW)).rejects.toMatchObject({
			code: "CONFLICT",
			message: "The slot you chose for Basic hygiene seminar is full. Choose a new slot for it.",
		})
		expect(insert).not.toHaveBeenCalled()
		expect(update).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
		expect(NotificationService.enqueue).not.toHaveBeenCalled()
	})

	it("refuses the same Service twice in one checkout", async () => {
		const { insert } = mockBookingTransaction({
			slots: [makeSlot(), makeSlot({ id: 8, startsAt: new Date("2026-12-04T00:00:00.000Z") })],
		})

		await expect(
			bookingService.create(
				{ items: [{ scheduleSlotId: 7 }, { scheduleSlotId: 8 }], acceptedPolicyDocumentIds: [] },
				"client-1",
				NOW
			)
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("Yellow fever vaccination is in your booking twice"),
		})
		expect(insert).not.toHaveBeenCalled()
	})

	it("refuses a booking when a policy that requires acceptance was not accepted (ADM-9)", async () => {
		const { insert, update } = mockBookingTransaction({ policies: [makePolicy()] })

		await expect(bookingService.create(oneSlot(), "client-1", NOW)).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("Terms of booking"),
		})
		expect(insert).not.toHaveBeenCalled()
		expect(update).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("asks for a policy that applies only to the second Service in the checkout (BKG-3)", async () => {
		const seminarTerms = makePolicy({
			id: 8,
			documentKey: "key-seminar",
			title: "Seminar attendance rules",
			appliesToAllServices: false,
			serviceIds: [3],
		})
		mockTwoServiceTransaction({ policies: [seminarTerms] })
		await expect(bookingService.create(twoSlots(), "client-1", NOW)).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: expect.stringContaining("Seminar attendance rules"),
		})

		const { acceptanceValues } = mockTwoServiceTransaction({ policies: [seminarTerms] })
		await expect(bookingService.create(twoSlots([8]), "client-1", NOW)).resolves.toMatchObject({
			id: 31,
		})
		expect(acceptanceValues).toHaveBeenCalledWith([
			{ bookingId: 31, policyDocumentId: 8, clientId: "client-1", acceptedAt: NOW },
		])
	})

	it("refuses an acceptance of a version that has since been replaced", async () => {
		// The client read version 1 (id 3); version 2 (id 4) took effect before they confirmed.
		mockBookingTransaction({
			policies: [makePolicy({ id: 3, version: 1 }), makePolicy({ id: 4, version: 2 })],
		})

		await expect(bookingService.create(oneSlot([3]), "client-1", NOW)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		})
	})

	it("stores the accepted version and the time against the booking, and audits it", async () => {
		const { tx, acceptanceValues } = mockBookingTransaction({ policies: [makePolicy()] })

		await bookingService.create(oneSlot([4]), "client-1", NOW)

		expect(acceptanceValues).toHaveBeenCalledWith([
			{ bookingId: 31, policyDocumentId: 4, clientId: "client-1", acceptedAt: NOW },
		])
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "booking.create",
				newValue: expect.objectContaining({
					acceptedPolicies: [{ policyDocumentId: 4, documentKey: "key-terms", version: 2 }],
				}),
			}),
			tx
		)
	})

	it("ignores policies for other services, withdrawn ones, and ones not yet in effect", async () => {
		const { acceptanceValues } = mockBookingTransaction({
			policies: [
				makePolicy({ id: 5, appliesToAllServices: false, serviceIds: [9] }),
				makePolicy({ id: 6, documentKey: "key-old", withdrawnAt: NOW }),
				makePolicy({ id: 7, documentKey: "key-new", effectiveFrom: "2026-12-01" }),
			],
		})

		await expect(bookingService.create(oneSlot(), "client-1", NOW)).resolves.toMatchObject({
			id: 31,
		})
		expect(acceptanceValues).not.toHaveBeenCalled()
	})

	it("books without a checkbox when the policy is for reading only", async () => {
		const { acceptanceValues } = mockBookingTransaction({
			policies: [makePolicy({ requiresAcceptance: false })],
		})

		await expect(bookingService.create(oneSlot(), "client-1", NOW)).resolves.toMatchObject({
			id: 31,
		})
		expect(acceptanceValues).not.toHaveBeenCalled()
	})

	it("tells the second of two clients the slot is full once the last place is taken", async () => {
		// What the second request sees after waiting for the first one's lock.
		const { insert, update } = mockBookingTransaction({
			slots: [makeSlot({ capacity: 20, bookedCount: 20 })],
		})

		await expect(bookingService.create(oneSlot(), "client-2", NOW)).rejects.toMatchObject({
			code: "CONFLICT",
			message: "The slot you chose for Yellow fever vaccination is full. Choose a new slot for it.",
		})
		expect(insert).not.toHaveBeenCalled()
		expect(update).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("refuses a disabled slot", async () => {
		const { insert, update } = mockBookingTransaction({
			slots: [makeSlot({ isDisabled: true, bookedCount: 0 })],
		})

		await expect(bookingService.create(oneSlot(), "client-1", NOW)).rejects.toMatchObject({
			code: "CONFLICT",
			message: expect.stringContaining("is no longer available"),
		})
		expect(insert).not.toHaveBeenCalled()
		expect(update).not.toHaveBeenCalled()
	})

	it("refuses a slot that has already started", async () => {
		const { insert } = mockBookingTransaction({
			slots: [makeSlot({ startsAt: new Date("2026-11-17T06:00:00.000Z"), bookedCount: 0 })],
		})

		await expect(bookingService.create(oneSlot(), "client-1", NOW)).rejects.toMatchObject({
			code: "CONFLICT",
			message: expect.stringContaining("has already started"),
		})
		expect(insert).not.toHaveBeenCalled()
	})

	it("refuses a slot whose service or location has been disabled", async () => {
		mockBookingTransaction({ services: [{ ...service, isActive: false }] })
		await expect(bookingService.create(oneSlot(), "client-1", NOW)).rejects.toMatchObject({
			code: "CONFLICT",
		})

		mockBookingTransaction({ locations: [{ ...location, isActive: false }] })
		await expect(bookingService.create(oneSlot(), "client-1", NOW)).rejects.toMatchObject({
			code: "CONFLICT",
		})
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("returns not found when any slot of the checkout is unknown", async () => {
		mockBookingTransaction({ slots: [] })
		await expect(
			bookingService.create(
				{ items: [{ scheduleSlotId: 99 }], acceptedPolicyDocumentIds: [] },
				"client-1",
				NOW
			)
		).rejects.toMatchObject({ code: "NOT_FOUND" })

		const { insert } = mockBookingTransaction({ slots: [makeSlot()] })
		await expect(
			bookingService.create(
				{ items: [{ scheduleSlotId: 7 }, { scheduleSlotId: 99 }], acceptedPolicyDocumentIds: [] },
				"client-1",
				NOW
			)
		).rejects.toMatchObject({ code: "NOT_FOUND", message: expect.stringContaining("99") })
		expect(insert).not.toHaveBeenCalled()
	})

	it("refuses a client who already has an unpaid booking, under a lock on their own row", async () => {
		const { clientLock, insert } = mockBookingTransaction({
			unpaid: [{ referenceNumber: "QSPS-261116-ZZ99ZZ" }],
		})

		await expect(bookingService.create(oneSlot(), "client-1", NOW)).rejects.toMatchObject({
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

		await bookingService.create(oneSlot(), "client-1", NOW)

		expect(generateReferenceNumber).toHaveBeenCalledTimes(2)
		expect(bookingValues).toHaveBeenCalledWith(
			expect.objectContaining({ referenceNumber: "QSPS-261117-FREE22" })
		)
	})

	it("gives up with a clear error when every Reference Number drawn is taken", async () => {
		const { insert } = mockBookingTransaction({
			referenceChecks: Array.from({ length: 5 }, () => [{ id: 5 }]),
		})

		await expect(bookingService.create(oneSlot(), "client-1", NOW)).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
		})
		expect(insert).not.toHaveBeenCalled()
	})

	it("refuses a request with no signed-in user before opening a transaction", async () => {
		await expect(bookingService.create(oneSlot(), null, NOW)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
		expect(db.transaction).not.toHaveBeenCalled()
	})
})

describe("BookingService.markPaid", () => {
	let bookingService: BookingService
	let auditService: { record: jest.Mock }

	function paymentTransaction(rows: unknown[]) {
		const lock = jest.fn()
		const set = jest.fn()
		const tx = {
			select: jest.fn().mockReturnValue(query(rows, lock)),
			update: jest.fn().mockReturnValue({
				set: (values: unknown) => {
					set(values)
					return { where: () => Promise.resolve(undefined) }
				},
			}),
		}
		return { tx, lock, set }
	}

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = new BookingService(
			auditService as unknown as AuditService,
			policies() as unknown as PolicyService
		)
	})

	it("locks the booking, marks it paid, clears the hold and audits", async () => {
		const { tx, lock, set } = paymentTransaction([{ id: 31, status: "pending_payment" }])

		await expect(bookingService.markPaid(tx as never, 31, null, NOW)).resolves.toBe(true)

		expect(lock).toHaveBeenCalledWith("update")
		expect(set).toHaveBeenCalledWith({ status: "paid", holdExpiresAt: null, updatedAt: NOW })
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "booking.paid",
				targetId: "31",
				oldValue: { status: "pending_payment" },
				newValue: { status: "paid" },
			}),
			tx
		)
	})

	it("leaves a cancelled booking alone and says so", async () => {
		const { tx, set } = paymentTransaction([{ id: 31, status: "cancelled" }])

		await expect(bookingService.markPaid(tx as never, 31, null, NOW)).resolves.toBe(false)
		expect(set).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("fails when the booking does not exist", async () => {
		const { tx } = paymentTransaction([])

		await expect(bookingService.markPaid(tx as never, 99, null, NOW)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
	})
})

/** A transaction whose selects answer in order; records every lock and status write. */
function itemTransaction(selects: unknown[][]) {
	const locks = jest.fn()
	const sets = jest.fn()
	const select = jest.fn()
	for (const rows of selects) select.mockReturnValueOnce(query(rows, locks))
	const tx = {
		select,
		update: jest.fn().mockReturnValue({
			set: (values: unknown) => {
				sets(values)
				return { where: () => Promise.resolve(undefined) }
			},
		}),
	}
	return { tx, locks, sets }
}

describe("BookingService.checkInItems (PRC-1)", () => {
	let bookingService: BookingService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = new BookingService(
			auditService as unknown as AuditService,
			policies() as unknown as PolicyService
		)
	})

	it("checks in the booked items of a paid booking, under locks, with an audit entry each", async () => {
		const { tx, locks, sets } = itemTransaction([
			[{ id: 31, status: "paid" }],
			[{ id: 44, status: "booked" }],
		])

		const result = await bookingService.checkInItems(tx as never, 31, 2, "staff-1", NOW)

		expect(result).toEqual({ ok: true, bookingItemIds: [44], checkedInIds: [44] })
		expect(locks).toHaveBeenCalledTimes(2)
		expect(locks).toHaveBeenCalledWith("update")
		expect(sets).toHaveBeenCalledWith({ status: "checked_in", updatedAt: NOW })
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "booking_item.check_in",
				actorId: "staff-1",
				targetType: "booking_item",
				targetId: "44",
				oldValue: { status: "booked" },
				newValue: { status: "checked_in" },
			}),
			tx
		)
	})

	it.each(["pending_payment", "cancelled", "pending_approval"])(
		"refuses with payment_required when the booking is %s, changing nothing",
		async status => {
			const { tx, sets } = itemTransaction([[{ id: 31, status }], [{ id: 44, status: "booked" }]])

			await expect(
				bookingService.checkInItems(tx as never, 31, 2, "staff-1", NOW)
			).resolves.toEqual({ ok: false, reason: "payment_required", bookingStatus: status })
			expect(sets).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		}
	)

	it("reports when the booking has no item at this location", async () => {
		const { tx, sets } = itemTransaction([[{ id: 31, status: "paid" }], []])

		await expect(bookingService.checkInItems(tx as never, 31, 9, "staff-1", NOW)).resolves.toEqual({
			ok: false,
			reason: "no_items_here",
		})
		expect(sets).not.toHaveBeenCalled()
	})

	it("leaves an item that is already checked in alone, so a second scan is harmless", async () => {
		const { tx, sets } = itemTransaction([
			[{ id: 31, status: "paid" }],
			[{ id: 44, status: "in_assessment" }],
		])

		await expect(bookingService.checkInItems(tx as never, 31, 2, "staff-1", NOW)).resolves.toEqual({
			ok: true,
			bookingItemIds: [44],
			checkedInIds: [],
		})
		expect(sets).not.toHaveBeenCalled()
	})
})

describe("BookingService.transitionItem (PRC-1)", () => {
	let bookingService: BookingService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = new BookingService(
			auditService as unknown as AuditService,
			policies() as unknown as PolicyService
		)
	})

	const options = { actorId: "staff-1", allowedFrom: ["in_assessment"] as const, now: NOW }

	it("locks the item, moves it and audits the move", async () => {
		const { tx, locks, sets } = itemTransaction([
			[{ id: 44, status: "in_assessment", serviceId: 1 }],
		])

		await expect(
			bookingService.transitionItem(tx as never, 44, "returned", options)
		).resolves.toEqual({ from: "in_assessment", to: "returned" })

		expect(locks).toHaveBeenCalledWith("update")
		expect(sets).toHaveBeenCalledWith({ status: "returned", updatedAt: NOW })
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "booking_item.returned",
				targetId: "44",
				oldValue: { status: "in_assessment" },
				newValue: { status: "returned" },
			}),
			tx
		)
	})

	it("clears an item whose service needs no approval", async () => {
		const { tx } = itemTransaction([
			[{ id: 44, status: "in_assessment", serviceId: 1 }],
			[{ requiresApproval: false }],
		])

		await expect(
			bookingService.transitionItem(tx as never, 44, "cleared", options)
		).resolves.toEqual({ from: "in_assessment", to: "cleared" })
	})

	it("sends a cleared item to head approval when its service requires approval", async () => {
		const { tx, sets } = itemTransaction([
			[{ id: 44, status: "in_assessment", serviceId: 1 }],
			[{ requiresApproval: true }],
		])

		await expect(
			bookingService.transitionItem(tx as never, 44, "cleared", options)
		).resolves.toEqual({ from: "in_assessment", to: "pending_head_approval" })
		expect(sets).toHaveBeenCalledWith({ status: "pending_head_approval", updatedAt: NOW })
	})

	it("refuses a move that is not an arrow in the state machine", async () => {
		const { tx, sets } = itemTransaction([[{ id: 44, status: "booked", serviceId: 1 }]])

		await expect(
			bookingService.transitionItem(tx as never, 44, "in_assessment", {
				...options,
				allowedFrom: ["booked"],
			})
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(sets).not.toHaveBeenCalled()
	})

	it("refuses a move from a status the caller did not expect", async () => {
		// pending_head_approval -> cleared is an arrow, but only head approval (PRC-3) may take it.
		const { tx, sets } = itemTransaction([
			[{ id: 44, status: "pending_head_approval", serviceId: 1 }],
		])

		await expect(
			bookingService.transitionItem(tx as never, 44, "cleared", options)
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(sets).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("fails when the item does not exist", async () => {
		const { tx } = itemTransaction([[]])

		await expect(
			bookingService.transitionItem(tx as never, 99, "returned", options)
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})
})

describe("BookingService.completeIfAllItemsFinal (CRT-1)", () => {
	let bookingService: BookingService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = new BookingService(
			auditService as unknown as AuditService,
			policies() as unknown as PolicyService
		)
	})

	it("completes a paid booking when every item is final, under a lock, with an audit entry", async () => {
		const { tx, locks, sets } = itemTransaction([
			[{ id: 31, status: "paid" }],
			[{ status: "issued" }, { status: "rejected" }],
		])
		await expect(
			bookingService.completeIfAllItemsFinal(tx as never, 31, "staff-1", NOW)
		).resolves.toBe(true)
		expect(locks).toHaveBeenCalledWith("update")
		expect(sets).toHaveBeenCalledWith({ status: "completed", updatedAt: NOW })
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "booking.completed",
				targetId: "31",
				oldValue: { status: "paid" },
				newValue: { status: "completed" },
			}),
			tx
		)
	})

	it("leaves the booking alone while an item is still open", async () => {
		const { tx, sets } = itemTransaction([
			[{ id: 31, status: "paid" }],
			[{ status: "issued" }, { status: "in_assessment" }],
		])
		await expect(
			bookingService.completeIfAllItemsFinal(tx as never, 31, "staff-1", NOW)
		).resolves.toBe(false)
		expect(sets).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("leaves a booking that is not paid alone", async () => {
		const { tx, sets } = itemTransaction([
			[{ id: 31, status: "completed" }],
			[{ status: "issued" }],
		])
		await expect(
			bookingService.completeIfAllItemsFinal(tx as never, 31, "staff-1", NOW)
		).resolves.toBe(false)
		expect(sets).not.toHaveBeenCalled()
	})
})

describe("BookingService.overrideItem (PRC-3)", () => {
	let bookingService: BookingService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = new BookingService(
			auditService as unknown as AuditService,
			policies() as unknown as PolicyService
		)
	})

	const options = { actorId: "head-1", reason: "Exemption letter verified by phone", now: NOW }

	it("clears a rejected item under a lock and audits the before and after state with the reason", async () => {
		const { tx, locks, sets } = itemTransaction([[{ id: 44, status: "rejected" }]])

		await expect(bookingService.overrideItem(tx as never, 44, "cleared", options)).resolves.toEqual(
			{
				from: "rejected",
				to: "cleared",
			}
		)

		expect(locks).toHaveBeenCalledWith("update")
		expect(sets).toHaveBeenCalledWith({ status: "cleared", updatedAt: NOW })
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "booking_item.override",
				actorId: "head-1",
				targetType: "booking_item",
				targetId: "44",
				oldValue: { status: "rejected" },
				newValue: { status: "cleared" },
				reason: "Exemption letter verified by phone",
			}),
			tx
		)
	})

	it.each(["in_assessment", "pending_head_approval", "cleared", "issued", "no_show"])(
		"refuses to override an item that is %s",
		async status => {
			const { tx, sets } = itemTransaction([[{ id: 44, status }]])

			await expect(
				bookingService.overrideItem(tx as never, 44, "cleared", options)
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(sets).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		}
	)

	it("refuses an override without a reason before reading the item", async () => {
		const { tx } = itemTransaction([[{ id: 44, status: "rejected" }]])

		await expect(
			bookingService.overrideItem(tx as never, 44, "cleared", { ...options, reason: "   " })
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(tx.select).not.toHaveBeenCalled()
	})

	it("fails when the item does not exist", async () => {
		const { tx } = itemTransaction([[]])

		await expect(
			bookingService.overrideItem(tx as never, 99, "cleared", options)
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})
})
