import { eq, inArray } from "drizzle-orm"

import {
	bookingItems,
	bookings,
	locations,
	notifications,
	payments,
	scheduleSlots,
	serviceCategories,
	services,
	users,
} from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { BookingExpiryService } from "@/common/maintenance/booking-expiry.service"
import type { PolicyService } from "@/common/policy/policy.service"
import { BookingService } from "@/modules/v1/bookings/bookings.service"
import { bindDbBackedTests } from "@/testing/db-ready"

/**
 * The booking expiry job (BKG-2) against a real database.
 *
 * Row locks, SKIP LOCKED and the slot count can only be shown on Postgres: a
 * mocked query builder would pass whatever the SQL said. Everything runs at a
 * clock in 2001, so the job can only ever see this file's own rows, never real
 * bookings in a shared dev database.
 *
 * Skips the database-backed cases when no Postgres is reachable or the tables
 * are missing (`pnpm db:migrate` not run), like expiry-cleanup.spec.ts.
 */
// Real database, but not the real policy store or oRPC: both load ESM-only
// packages Jest cannot require. The cutoff is answered by a stub below.
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
jest.mock("@/common/policy/policy.service", () => ({
	PolicyService: jest.fn(),
}))

/** The one row a query had to return. */
function must<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Expected a row")
	return value
}

describe("BookingExpiryService (BKG-2)", () => {
	const marker = `bkg2-${process.pid}`
	const NOW = new Date("2001-01-01T00:00:00.000Z")
	const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000)

	const dbTests = bindDbBackedTests({
		label: "bkg2",
		relations: [
			"users",
			"locations",
			"service_categories",
			"services",
			"schedule_slots",
			"bookings",
			"booking_items",
			"payments",
			"notifications",
		],
		database: db,
	})
	const itDb = dbTests.itDb

	let audit: { record: jest.Mock }
	let jobs: [BookingExpiryService, BookingExpiryService]

	const fixture = { userId: `${marker}-client`, locationId: 0, categoryId: 0, serviceId: 0 }
	const created = { bookingIds: [] as number[], slotIds: [] as number[] }
	let slotOffset = 0
	let referenceCounter = 0

	beforeAll(async () => {
		await dbTests.probe()
		if (!dbTests.ready) return

		await db.insert(users).values({
			id: fixture.userId,
			name: "BKG-2 test client",
			email: `${marker}@example.test`,
		})
		const [location] = await db
			.insert(locations)
			.values({
				code: `T${process.pid}`,
				name: `${marker} office`,
				address: "Test",
				region: "Test",
			})
			.returning({ id: locations.id })
		const [category] = await db
			.insert(serviceCategories)
			.values({ code: marker, name: marker })
			.returning({ id: serviceCategories.id })
		const [service] = await db
			.insert(services)
			.values({
				serviceCategoryId: must(category).id,
				code: `${marker}-svc`.toUpperCase(),
				name: `${marker} service`,
				feeCentavos: 10000,
			})
			.returning({ id: services.id })
		fixture.locationId = must(location).id
		fixture.categoryId = must(category).id
		fixture.serviceId = must(service).id
	})

	beforeEach(() => {
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		// The arrival cutoff answers 30 minutes, the documented default.
		const policies = { get: jest.fn().mockResolvedValue(30) } as unknown as PolicyService
		const bookingService = new BookingService(audit as unknown as AuditService, policies)
		jobs = [
			new BookingExpiryService(bookingService, policies),
			new BookingExpiryService(bookingService, policies),
		]
	})

	afterEach(async () => {
		if (!dbTests.ready) return
		// Each cancellation queues a client email (NTF-1); those rows block deleting the user.
		await db.delete(notifications).where(eq(notifications.userId, fixture.userId))
		if (created.bookingIds.length) {
			await db.delete(payments).where(inArray(payments.bookingId, created.bookingIds))
			await db.delete(bookingItems).where(inArray(bookingItems.bookingId, created.bookingIds))
			await db.delete(bookings).where(inArray(bookings.id, created.bookingIds))
		}
		if (created.slotIds.length) {
			await db.delete(scheduleSlots).where(inArray(scheduleSlots.id, created.slotIds))
		}
		created.bookingIds = []
		created.slotIds = []
	})

	afterAll(async () => {
		if (dbTests.ready) {
			await db.delete(services).where(eq(services.id, fixture.serviceId))
			await db.delete(serviceCategories).where(eq(serviceCategories.id, fixture.categoryId))
			await db.delete(locations).where(eq(locations.id, fixture.locationId))
			await db.delete(users).where(eq(users.id, fixture.userId))
		}
		if (dbTests.connected) await db.$client.end()
	})

	/** One unpaid Booking in its own slot, which already counts `bookedCount` places. */
	async function makeBooking(options: {
		holdExpiresAt: Date | null
		slotStartsAt: Date
		payOnsite?: boolean
		bookedCount?: number
		kind?: "regular" | "walk-in"
	}) {
		// Each slot gets its own start second: slots are unique per start time.
		const startsAt = new Date(options.slotStartsAt.getTime() + slotOffset++ * 1000)
		const [slot] = await db
			.insert(scheduleSlots)
			.values({
				serviceId: fixture.serviceId,
				locationId: fixture.locationId,
				startsAt,
				endsAt: new Date(startsAt.getTime() + 3_600_000),
				capacity: 10,
				bookedCount: options.bookedCount ?? 2,
			})
			.returning({ id: scheduleSlots.id })
		created.slotIds.push(must(slot).id)

		const suffix = `${process.pid % 1000}${referenceCounter++}`.padStart(6, "0").slice(-6)
		const [booking] = await db
			.insert(bookings)
			.values({
				referenceNumber: `QSPS-010101-${suffix}`,
				clientId: fixture.userId,
				status: "pending_payment",
				kind: options.kind ?? "regular",
				totalCentavos: 10000,
				holdExpiresAt: options.holdExpiresAt,
				payOnsite: options.payOnsite ?? false,
				createdBy: fixture.userId,
			})
			.returning({ id: bookings.id })
		created.bookingIds.push(must(booking).id)

		await db.insert(bookingItems).values({
			bookingId: must(booking).id,
			serviceId: fixture.serviceId,
			scheduleSlotId: must(slot).id,
			locationId: fixture.locationId,
			feeCentavos: 10000,
			status: "booked",
		})
		return { bookingId: must(booking).id, slotId: must(slot).id }
	}

	async function bookingRow(id: number) {
		const [row] = await db.select().from(bookings).where(eq(bookings.id, id))
		return must(row)
	}

	async function bookedCount(slotId: number) {
		const [row] = await db
			.select({ bookedCount: scheduleSlots.bookedCount })
			.from(scheduleSlots)
			.where(eq(scheduleSlots.id, slotId))
		return must(row).bookedCount
	}

	itDb("cancels a booking whose hold has passed as hold_expired and frees its place", async () => {
		const { bookingId, slotId } = await makeBooking({
			holdExpiresAt: minutes(-1),
			slotStartsAt: minutes(24 * 60),
		})

		await expect(jobs[0].expireDue(NOW)).resolves.toEqual({ holdExpired: 1, noShow: 0, failed: 0 })

		const row = await bookingRow(bookingId)
		expect(row.status).toBe("cancelled")
		expect(row.cancelReason).toBe("hold_expired")
		expect(row.cancelledAt).toEqual(NOW)
		expect(row.holdExpiresAt).toBeNull()
		expect(await bookedCount(slotId)).toBe(1)
		// System action: no actor, and the domain names the job.
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "booking-expiry",
				action: "booking.cancelled",
				actorId: null,
				targetId: String(bookingId),
				newValue: expect.objectContaining({ cancelReason: "hold_expired" }),
			}),
			expect.anything()
		)
	})

	itDb("leaves a booking whose hold has not passed", async () => {
		const { bookingId, slotId } = await makeBooking({
			holdExpiresAt: minutes(5),
			slotStartsAt: minutes(24 * 60),
		})

		await jobs[0].expireDue(NOW)

		expect((await bookingRow(bookingId)).status).toBe("pending_payment")
		expect(await bookedCount(slotId)).toBe(2)
	})

	itDb("cancels an onsite booking still unpaid at the arrival cutoff as no_show", async () => {
		// The slot starts in 20 minutes; the cutoff is 30 minutes before it.
		const { bookingId, slotId } = await makeBooking({
			holdExpiresAt: null,
			payOnsite: true,
			slotStartsAt: minutes(20),
		})

		await expect(jobs[0].expireDue(NOW)).resolves.toEqual({ holdExpired: 0, noShow: 1, failed: 0 })

		const row = await bookingRow(bookingId)
		expect(row.status).toBe("cancelled")
		expect(row.cancelReason).toBe("no_show")
		expect(await bookedCount(slotId)).toBe(1)
	})

	itDb(
		"never cancels a walk-in at the arrival cutoff, even in a slot in progress (PRC-2)",
		async () => {
			const { bookingId, slotId } = await makeBooking({
				holdExpiresAt: minutes(45),
				slotStartsAt: minutes(-30),
				kind: "walk-in",
			})

			await jobs[0].expireDue(NOW)

			expect((await bookingRow(bookingId)).status).toBe("pending_payment")
			expect(await bookedCount(slotId)).toBe(2)
		}
	)

	itDb("still releases an unpaid walk-in once its payment hold passes (PRC-2)", async () => {
		const { bookingId, slotId } = await makeBooking({
			holdExpiresAt: minutes(-1),
			slotStartsAt: minutes(-30),
			kind: "walk-in",
		})

		await expect(jobs[0].expireDue(NOW)).resolves.toEqual({ holdExpired: 1, noShow: 0, failed: 0 })

		const row = await bookingRow(bookingId)
		expect(row.cancelReason).toBe("hold_expired")
		expect(await bookedCount(slotId)).toBe(1)
	})

	itDb("does not apply the hold to an onsite booking before its cutoff", async () => {
		// A stale hold time left on the row must not cancel an onsite booking.
		const { bookingId } = await makeBooking({
			holdExpiresAt: minutes(-120),
			payOnsite: true,
			slotStartsAt: minutes(24 * 60),
		})

		await jobs[0].expireDue(NOW)

		expect((await bookingRow(bookingId)).status).toBe("pending_payment")
	})

	itDb("waits while a payment is pending, then expires once the payment times out", async () => {
		const { bookingId, slotId } = await makeBooking({
			holdExpiresAt: minutes(-1),
			slotStartsAt: minutes(24 * 60),
		})
		await db.insert(payments).values({
			bookingId,
			channelCode: "fake",
			providerCode: "fake",
			amountCentavos: 10000,
			status: "pending",
			createdAt: minutes(-10),
			updatedAt: minutes(-10),
		})

		await jobs[0].expireDue(NOW)
		expect((await bookingRow(bookingId)).status).toBe("pending_payment")
		expect(await bookedCount(slotId)).toBe(2)

		// 61 minutes after the payment started, it no longer holds the booking.
		await jobs[0].expireDue(minutes(51))
		expect((await bookingRow(bookingId)).cancelReason).toBe("hold_expired")
		expect(await bookedCount(slotId)).toBe(1)
	})

	itDb("cancels once and frees one place when two runs overlap", async () => {
		const { bookingId, slotId } = await makeBooking({
			holdExpiresAt: minutes(-1),
			slotStartsAt: minutes(24 * 60),
			bookedCount: 2,
		})

		const [first, second] = await Promise.all([jobs[0].expireDue(NOW), jobs[1].expireDue(NOW)])

		expect(first.holdExpired + second.holdExpired).toBe(1)
		expect((await bookingRow(bookingId)).status).toBe("cancelled")
		// 2 → 1, not 0: the place was given back exactly once.
		expect(await bookedCount(slotId)).toBe(1)
		const cancellations = audit.record.mock.calls.filter(
			([event]) => (event as { action: string }).action === "booking.cancelled"
		)
		expect(cancellations).toHaveLength(1)
	})

	itDb("a second run after the first finds nothing to do", async () => {
		const { slotId } = await makeBooking({
			holdExpiresAt: minutes(-1),
			slotStartsAt: minutes(24 * 60),
		})

		await jobs[0].expireDue(NOW)
		await expect(jobs[0].expireDue(NOW)).resolves.toEqual({ holdExpired: 0, noShow: 0, failed: 0 })
		expect(await bookedCount(slotId)).toBe(1)
	})

	it("logs instead of throwing when a run fails, so the cron keeps going", async () => {
		const spy = jest.spyOn(jobs[0], "expireDue").mockRejectedValue(new Error("boom"))
		const log = jest.spyOn(jobs[0]["logger"], "error").mockImplementation(() => undefined)

		await expect(jobs[0].run()).resolves.toBeUndefined()
		expect(log).toHaveBeenCalled()

		spy.mockRestore()
		log.mockRestore()
	})
})
