import { scheduleSlots } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { denyOutsideScope } from "@/common/scope/scope-denial"
import { inScope, type ResolvedScope } from "@/common/scope/scope-match"
import type * as ScopeMatch from "@/common/scope/scope-match"

import {
	MAX_SLOTS_PER_REQUEST,
	scheduleDateRange,
	SchedulesService,
	slotAvailability,
	slotTimesFor,
} from "./schedules.service"

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

// The real Scope rules, wrapped so a test can play a user outside the Scope.
jest.mock("@/common/scope/scope-match", () => {
	const actual = jest.requireActual<typeof ScopeMatch>("@/common/scope/scope-match")
	return { ...actual, inScope: jest.fn(actual.inScope) }
})

// ADM-2: outside the Scope answers like a missing record.
jest.mock("@/common/scope/scope-denial", () => ({
	denyOutsideScope: jest.fn(() => {
		const { ORPCError } = jest.requireMock<{
			ORPCError: new (code: string, options: { message: string }) => Error
		}>("@orpc/server")
		return Promise.reject(new ORPCError("NOT_FOUND", { message: 'Location "2" was not found' }))
	}),
}))

/** Tuesday 1 December 2026, 09:00 in Manila. */
const NOW = new Date("2026-12-01T01:00:00.000Z")

/** A staff user limited to some Locations; `inScope` is set per test. */
const LIMITED_SCOPE = { nationwide: false } as unknown as ResolvedScope

const makeSlot = (overrides: Record<string, unknown> = {}) => ({
	id: 7,
	serviceId: 1,
	locationId: 2,
	startsAt: new Date("2026-12-02T00:00:00.000Z"),
	endsAt: new Date("2026-12-02T02:00:00.000Z"),
	capacity: 20,
	bookedCount: 0,
	isDisabled: false,
	disabledReason: null,
	createdAt: new Date("2026-11-17T00:00:00.000Z"),
	updatedAt: new Date("2026-11-17T00:00:00.000Z"),
	...overrides,
})

const activeService = { id: 1, name: "Yellow fever vaccination", isActive: true }
const activeLocation = { id: 2, name: "Manila", isActive: true }
/** What the bulk actions read first: the service's category, for the Scope check. */
const serviceCategory = { serviceCategoryId: 3 }

/** Wednesday 2 December and Monday 7 December, two windows each: four slots. */
const generateInput = {
	serviceId: 1,
	locationId: 2,
	startDate: "2026-12-01",
	endDate: "2026-12-07",
	weekdays: [1, 3],
	windows: [
		{ startTime: "08:00", endTime: "10:00" },
		{ startTime: "10:00", endTime: "12:00" },
	],
	capacity: 20,
}

/** select().from().where() resolving to rows. */
const selectRows = (rows: unknown[]) => ({
	from: () => ({ where: () => Promise.resolve(rows) }),
})
/** select().from().where().for("update") resolving to rows. */
const selectLocked = (rows: unknown[], lock = jest.fn()) => ({
	from: () => ({
		where: () => ({
			for: (mode: string) => {
				lock(mode)
				return Promise.resolve(rows)
			},
		}),
	}),
})
/** select().from().where().orderBy().for("update") resolving to rows. */
const selectLockedOrdered = (rows: unknown[], lock = jest.fn()) => ({
	from: () => ({
		where: () => ({
			orderBy: () => ({
				for: (mode: string) => {
					lock(mode)
					return Promise.resolve(rows)
				},
			}),
		}),
	}),
})
/** select().from().innerJoin()….where().orderBy() resolving to rows. */
const selectJoined = (rows: unknown[]) => {
	const innerJoin = jest.fn()
	const chain = { innerJoin, where: () => ({ orderBy: () => Promise.resolve(rows) }) }
	innerJoin.mockReturnValue(chain)
	return { from: () => chain }
}
/** update().set().where().returning() resolving to rows. */
const updateReturning = (rows: unknown[], set = jest.fn()) => ({
	set: (values: unknown) => {
		set(values)
		return { where: () => ({ returning: () => Promise.resolve(rows) }) }
	},
})
/** update().set().where() resolving with nothing. */
const updateAll = (set = jest.fn()) => ({
	set: (values: unknown) => {
		set(values)
		return { where: () => Promise.resolve(undefined) }
	},
})

function mockTransaction(tx: Record<string, unknown>) {
	jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
	return tx
}

/** A transaction whose INSERT … RETURNING reports `createdPerCall` new rows. */
function generateTransaction(createdPerCall: number[]) {
	const values = jest.fn()
	const onConflictDoNothing = jest.fn()
	let call = 0
	const insert = jest.fn(() => ({
		values: (rows: unknown) => {
			values(rows)
			return {
				onConflictDoNothing: (options: unknown) => {
					onConflictDoNothing(options)
					const created = createdPerCall[call++] ?? 0
					return {
						returning: () => Promise.resolve(Array.from({ length: created }, (_, id) => ({ id }))),
					}
				},
			}
		},
	}))
	const tx = mockTransaction({
		select: jest
			.fn()
			.mockReturnValueOnce(selectRows([activeService]))
			.mockReturnValueOnce(selectRows([activeLocation])),
		insert,
	})
	return { tx, insert, values, onConflictDoNothing }
}

describe("slotTimesFor", () => {
	it("gives one slot per chosen weekday and window, converted from Manila time to UTC", () => {
		expect(
			slotTimesFor(generateInput).map(({ startsAt, endsAt }) => [
				startsAt.toISOString(),
				endsAt.toISOString(),
			])
		).toEqual([
			["2026-12-02T00:00:00.000Z", "2026-12-02T02:00:00.000Z"],
			["2026-12-02T02:00:00.000Z", "2026-12-02T04:00:00.000Z"],
			["2026-12-07T00:00:00.000Z", "2026-12-07T02:00:00.000Z"],
			["2026-12-07T02:00:00.000Z", "2026-12-07T04:00:00.000Z"],
		])
	})

	it("gives nothing when no date in the range falls on a chosen weekday", () => {
		expect(slotTimesFor({ ...generateInput, endDate: "2026-12-01", weekdays: [0] })).toEqual([])
	})
})

describe("slotAvailability", () => {
	it("reports the places left on an open slot", () => {
		expect(slotAvailability(makeSlot({ capacity: 20, bookedCount: 5 }), NOW)).toEqual({
			id: 7,
			startsAt: new Date("2026-12-02T00:00:00.000Z"),
			endsAt: new Date("2026-12-02T02:00:00.000Z"),
			remainingCapacity: 15,
			isAvailable: true,
		})
	})

	it("marks a full slot unavailable", () => {
		expect(slotAvailability(makeSlot({ capacity: 20, bookedCount: 20 }), NOW)).toMatchObject({
			remainingCapacity: 0,
			isAvailable: false,
		})
	})

	it("marks a disabled slot unavailable even when it has places left", () => {
		expect(slotAvailability(makeSlot({ isDisabled: true, bookedCount: 5 }), NOW)).toMatchObject({
			remainingCapacity: 15,
			isAvailable: false,
		})
	})

	it("marks a slot that has already started unavailable", () => {
		const started = makeSlot({ startsAt: new Date("2026-12-01T00:00:00.000Z") })
		expect(slotAvailability(started, NOW).isAvailable).toBe(false)
	})

	it("never reports fewer than zero places when bookings exceed capacity", () => {
		// A VIP Booking bypasses capacity, so booked_count can pass it.
		expect(slotAvailability(makeSlot({ capacity: 20, bookedCount: 21 }), NOW)).toMatchObject({
			remainingCapacity: 0,
			isAvailable: false,
		})
	})
})

describe("scheduleDateRange (SCH-2)", () => {
	it("covers one Manila day", () => {
		const range = scheduleDateRange("2026-12-02", "day")
		expect(range.startDate).toBe("2026-12-02")
		expect(range.lastDate).toBe("2026-12-02")
		// Manila midnight is 16:00 UTC the day before.
		expect(range.start.toISOString()).toBe("2026-12-01T16:00:00.000Z")
		expect(range.end.toISOString()).toBe("2026-12-02T16:00:00.000Z")
	})

	it("covers Monday to Sunday for a date in the middle of the week", () => {
		// Wednesday 2 December 2026.
		const range = scheduleDateRange("2026-12-02", "week")
		expect(range.startDate).toBe("2026-11-30")
		expect(range.lastDate).toBe("2026-12-06")
		expect(range.start.toISOString()).toBe("2026-11-29T16:00:00.000Z")
		expect(range.end.toISOString()).toBe("2026-12-06T16:00:00.000Z")
	})

	it("counts a Sunday as the end of its week, not the start of the next", () => {
		const range = scheduleDateRange("2026-12-06", "week")
		expect(range.startDate).toBe("2026-11-30")
		expect(range.lastDate).toBe("2026-12-06")
	})

	it("covers the whole calendar month, including across a year end", () => {
		const range = scheduleDateRange("2026-12-15", "month")
		expect(range.startDate).toBe("2026-12-01")
		expect(range.lastDate).toBe("2026-12-31")
		expect(range.start.toISOString()).toBe("2026-11-30T16:00:00.000Z")
		expect(range.end.toISOString()).toBe("2026-12-31T16:00:00.000Z")
	})
})

describe("SchedulesService", () => {
	let service: SchedulesService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		service = new SchedulesService(auditService as unknown as AuditService)
	})

	describe("generateSlots", () => {
		it("creates one slot per date and window, skips existing ones, and audits the request", async () => {
			// Three rows inserted out of four: one already existed.
			const { tx, values, onConflictDoNothing } = generateTransaction([3])

			await expect(service.generateSlots(generateInput, "staff-1", NOW)).resolves.toEqual({
				createdCount: 3,
				skippedCount: 1,
			})

			expect(values).toHaveBeenCalledTimes(1)
			expect(values.mock.calls[0]?.[0]).toHaveLength(4)
			expect(values.mock.calls[0]?.[0]?.[0]).toEqual({
				serviceId: 1,
				locationId: 2,
				startsAt: new Date("2026-12-02T00:00:00.000Z"),
				endsAt: new Date("2026-12-02T02:00:00.000Z"),
				capacity: 20,
			})
			// The uniqueness rule is what makes "skip existing" safe.
			expect(onConflictDoNothing).toHaveBeenCalledWith({
				target: [scheduleSlots.serviceId, scheduleSlots.locationId, scheduleSlots.startsAt],
			})
			expect(auditService.record).toHaveBeenCalledTimes(1)
			expect(auditService.record).toHaveBeenCalledWith(
				{
					domain: "schedules",
					action: "schedule.slots.generate",
					actorId: "staff-1",
					targetType: "schedule_slot",
					targetId: null,
					oldValue: null,
					newValue: { ...generateInput, createdCount: 3, skippedCount: 1 },
				},
				tx
			)
		})

		it("never sets booked_count: only BookingService changes it", async () => {
			const { values } = generateTransaction([4])

			await service.generateSlots(generateInput, "staff-1", NOW)

			for (const row of values.mock.calls[0]?.[0] as Record<string, unknown>[]) {
				expect(row).not.toHaveProperty("bookedCount")
			}
		})

		it("reports everything as skipped when the same range is generated again", async () => {
			generateTransaction([0])

			await expect(service.generateSlots(generateInput, "staff-1", NOW)).resolves.toEqual({
				createdCount: 0,
				skippedCount: 4,
			})
		})

		it("inserts a large range in batches", async () => {
			// Every day for 366 days with two windows: 732 slots, so two batches.
			const { insert } = generateTransaction([500, 232])

			await expect(
				service.generateSlots(
					{
						...generateInput,
						startDate: "2026-12-01",
						endDate: "2027-12-01",
						weekdays: [0, 1, 2, 3, 4, 5, 6],
					},
					"staff-1",
					NOW
				)
			).resolves.toEqual({ createdCount: 732, skippedCount: 0 })
			expect(insert).toHaveBeenCalledTimes(2)
		})

		it(`refuses a request for more than ${MAX_SLOTS_PER_REQUEST} slots before touching the database`, async () => {
			const windows = [8, 9, 10, 11, 13, 14].map(hour => ({
				startTime: `${String(hour).padStart(2, "0")}:00`,
				endTime: `${String(hour + 1).padStart(2, "0")}:00`,
			}))

			await expect(
				service.generateSlots(
					{
						...generateInput,
						startDate: "2026-12-01",
						endDate: "2027-12-01",
						weekdays: [0, 1, 2, 3, 4, 5, 6],
						windows,
					},
					"staff-1",
					NOW
				)
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: expect.stringContaining("2196 slots"),
			})
			expect(db.transaction).not.toHaveBeenCalled()
		})

		it("refuses a start date that is already past in Manila", async () => {
			await expect(
				service.generateSlots({ ...generateInput, startDate: "2026-11-30" }, "staff-1", NOW)
			).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Start date cannot be in the past" })
			expect(db.transaction).not.toHaveBeenCalled()
		})

		it("accepts today's date in Manila even when the UTC date is still yesterday", async () => {
			// 00:30 on 2 December in Manila is 16:30 on 1 December in UTC.
			const justAfterMidnight = new Date("2026-12-01T16:30:00.000Z")
			generateTransaction([2])

			await expect(
				service.generateSlots(
					{ ...generateInput, startDate: "2026-12-02", endDate: "2026-12-02" },
					"staff-1",
					justAfterMidnight
				)
			).resolves.toEqual({ createdCount: 2, skippedCount: 0 })
		})

		it("refuses a range with no date on the chosen weekdays", async () => {
			await expect(
				service.generateSlots(
					{ ...generateInput, endDate: "2026-12-01", weekdays: [0] },
					"staff-1",
					NOW
				)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(db.transaction).not.toHaveBeenCalled()
		})

		it("returns not found for an unknown service and writes nothing", async () => {
			const insert = jest.fn()
			mockTransaction({ select: jest.fn().mockReturnValueOnce(selectRows([])), insert })

			await expect(service.generateSlots(generateInput, "staff-1", NOW)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(insert).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		})

		it("refuses a disabled service or location and writes nothing", async () => {
			const insert = jest.fn()
			mockTransaction({
				select: jest.fn().mockReturnValueOnce(selectRows([{ ...activeService, isActive: false }])),
				insert,
			})
			await expect(service.generateSlots(generateInput, "staff-1", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
				message: expect.stringContaining("Yellow fever vaccination"),
			})

			mockTransaction({
				select: jest
					.fn()
					.mockReturnValueOnce(selectRows([activeService]))
					.mockReturnValueOnce(selectRows([{ ...activeLocation, isActive: false }])),
				insert,
			})
			await expect(service.generateSlots(generateInput, "staff-1", NOW)).rejects.toMatchObject({
				code: "CONFLICT",
				message: expect.stringContaining("Manila"),
			})

			expect(insert).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		})
	})

	describe("bulkUpdateCapacity (SCH-2)", () => {
		const bulkInput = {
			serviceId: 1,
			locationId: 2,
			period: "week" as const,
			anchorDate: "2026-12-02",
			capacity: 10,
		}

		it("updates every slot in the period, lists back the ones with more bookings, and audits counts", async () => {
			const slots = [
				makeSlot({ id: 7, bookedCount: 5 }),
				makeSlot({
					id: 8,
					bookedCount: 12,
					startsAt: new Date("2026-12-03T00:00:00.000Z"),
				}),
				makeSlot({ id: 9, bookedCount: 0 }),
			]
			const lock = jest.fn()
			const set = jest.fn()
			const update = jest.fn().mockReturnValue(updateAll(set))
			const tx = mockTransaction({
				select: jest
					.fn()
					.mockReturnValueOnce(selectRows([serviceCategory]))
					.mockReturnValueOnce(selectLockedOrdered(slots, lock)),
				update,
			})

			await expect(service.bulkUpdateCapacity(bulkInput, "staff-1")).resolves.toEqual({
				selectedCount: 3,
				updatedCount: 2,
				skipped: [
					{
						id: 8,
						startsAt: new Date("2026-12-03T00:00:00.000Z"),
						bookedCount: 12,
						capacity: 20,
					},
				],
			})

			// Locked so a booking cannot slip in between the check and the update.
			expect(lock).toHaveBeenCalledWith("update")
			// One statement for every slot that can take the new capacity.
			expect(update).toHaveBeenCalledTimes(1)
			expect(set).toHaveBeenCalledWith(expect.objectContaining({ capacity: 10 }))
			expect(set.mock.calls[0]?.[0]).not.toHaveProperty("bookedCount")
			expect(auditService.record).toHaveBeenCalledTimes(1)
			expect(auditService.record).toHaveBeenCalledWith(
				{
					domain: "schedules",
					action: "schedule.slots.capacity.bulk_update",
					actorId: "staff-1",
					targetType: "schedule_slot",
					targetId: null,
					oldValue: null,
					newValue: {
						serviceId: 1,
						locationId: 2,
						period: "week",
						startDate: "2026-11-30",
						endDate: "2026-12-06",
						capacity: 10,
						selectedCount: 3,
						updatedCount: 2,
						skippedCount: 1,
					},
				},
				tx
			)
		})

		it("allows a new capacity equal to the booked count", async () => {
			mockTransaction({
				select: jest
					.fn()
					.mockReturnValueOnce(selectRows([serviceCategory]))
					.mockReturnValueOnce(selectLockedOrdered([makeSlot({ bookedCount: 10 })])),
				update: jest.fn().mockReturnValue(updateAll()),
			})

			await expect(service.bulkUpdateCapacity(bulkInput, "staff-1")).resolves.toMatchObject({
				updatedCount: 1,
				skipped: [],
			})
		})

		it("changes nothing when every slot already has more bookings, and still audits", async () => {
			const update = jest.fn()
			mockTransaction({
				select: jest
					.fn()
					.mockReturnValueOnce(selectRows([serviceCategory]))
					.mockReturnValueOnce(
						selectLockedOrdered([
							makeSlot({ id: 7, bookedCount: 11 }),
							makeSlot({ id: 8, bookedCount: 15 }),
						])
					),
				update,
			})

			await expect(service.bulkUpdateCapacity(bulkInput, "staff-1")).resolves.toMatchObject({
				selectedCount: 2,
				updatedCount: 0,
			})
			expect(update).not.toHaveBeenCalled()
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					newValue: expect.objectContaining({ updatedCount: 0, skippedCount: 2 }),
				}),
				expect.anything()
			)
		})

		it("returns not found for an unknown service and reads no slots", async () => {
			const select = jest.fn().mockReturnValueOnce(selectRows([]))
			const update = jest.fn()
			mockTransaction({ select, update })

			await expect(service.bulkUpdateCapacity(bulkInput, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(select).toHaveBeenCalledTimes(1)
			expect(update).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		})

		it("refuses a user outside the Scope before reading any slot, even on an empty period", async () => {
			jest.mocked(inScope).mockReturnValueOnce(false)
			const select = jest.fn().mockReturnValueOnce(selectRows([serviceCategory]))
			const update = jest.fn()
			mockTransaction({ select, update })

			await expect(
				service.bulkUpdateCapacity(bulkInput, "staff-1", LIMITED_SCOPE)
			).rejects.toMatchObject({ code: "NOT_FOUND" })

			expect(denyOutsideScope).toHaveBeenCalledWith(
				auditService,
				"staff-1",
				expect.objectContaining({ type: "location", id: 2 }),
				{ serviceCategoryId: 3, locationId: 2 }
			)
			expect(select).toHaveBeenCalledTimes(1)
			expect(update).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		})
	})

	describe("blockDate (SCH-2)", () => {
		const blockInput = { serviceId: 1, locationId: 2, date: "2026-12-02", reason: "Holiday" }

		it("disables the date's slots with the reason and lists paid bookings once, without cancelling them", async () => {
			const slots = [
				makeSlot({ id: 7 }),
				// Disabled by hand: left alone so a later unblock keeps it disabled.
				makeSlot({ id: 8, isDisabled: true, disabledReason: null }),
				// Blocked before: its reason is updated.
				makeSlot({ id: 9, isDisabled: true, disabledReason: "Typhoon" }),
			]
			const paidRows = [
				{ referenceNumber: "QSPS-261202-AAAAAA", startsAt: new Date("2026-12-02T00:00:00.000Z") },
				// The same booking with a second item later that day.
				{ referenceNumber: "QSPS-261202-AAAAAA", startsAt: new Date("2026-12-02T02:00:00.000Z") },
				{ referenceNumber: "QSPS-261202-BBBBBB", startsAt: new Date("2026-12-02T02:00:00.000Z") },
			]
			const set = jest.fn()
			const update = jest.fn().mockReturnValue(updateAll(set))
			const tx = mockTransaction({
				select: jest
					.fn()
					.mockReturnValueOnce(selectRows([serviceCategory]))
					.mockReturnValueOnce(selectLockedOrdered(slots))
					.mockReturnValueOnce(selectJoined(paidRows)),
				update,
			})

			await expect(service.blockDate(blockInput, "staff-1")).resolves.toEqual({
				disabledCount: 2,
				paidBookings: [
					{ referenceNumber: "QSPS-261202-AAAAAA", startsAt: new Date("2026-12-02T00:00:00.000Z") },
					{ referenceNumber: "QSPS-261202-BBBBBB", startsAt: new Date("2026-12-02T02:00:00.000Z") },
				],
			})

			// One update, on schedule_slots only: no booking is cancelled or changed.
			expect(update).toHaveBeenCalledTimes(1)
			expect(update).toHaveBeenCalledWith(scheduleSlots)
			expect(set).toHaveBeenCalledWith(
				expect.objectContaining({ isDisabled: true, disabledReason: "Holiday" })
			)
			expect(auditService.record).toHaveBeenCalledWith(
				{
					domain: "schedules",
					action: "schedule.date.block",
					actorId: "staff-1",
					targetType: "schedule_date",
					targetId: "1:2:2026-12-02",
					oldValue: null,
					newValue: {
						serviceId: 1,
						locationId: 2,
						date: "2026-12-02",
						reason: "Holiday",
						slotCount: 3,
						disabledCount: 2,
						paidBookingCount: 2,
					},
				},
				tx
			)
		})

		it("does nothing but audit when the date has no slots", async () => {
			const select = jest
				.fn()
				.mockReturnValueOnce(selectRows([serviceCategory]))
				.mockReturnValueOnce(selectLockedOrdered([]))
			const update = jest.fn()
			mockTransaction({ select, update })

			await expect(service.blockDate(blockInput, "staff-1")).resolves.toEqual({
				disabledCount: 0,
				paidBookings: [],
			})
			// No paid-bookings query when there are no slots to look in.
			expect(select).toHaveBeenCalledTimes(2)
			expect(update).not.toHaveBeenCalled()
			expect(auditService.record).toHaveBeenCalledTimes(1)
		})

		it("refuses a user outside the Scope before reading any slot", async () => {
			jest.mocked(inScope).mockReturnValueOnce(false)
			const select = jest.fn().mockReturnValueOnce(selectRows([serviceCategory]))
			const update = jest.fn()
			mockTransaction({ select, update })

			await expect(service.blockDate(blockInput, "staff-1", LIMITED_SCOPE)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(select).toHaveBeenCalledTimes(1)
			expect(update).not.toHaveBeenCalled()
		})
	})

	describe("unblockDate (SCH-2)", () => {
		const unblockInput = { serviceId: 1, locationId: 2, date: "2026-12-02" }

		it("re-enables only the slots a date block disabled, and audits the count", async () => {
			// The query keeps only slots with a reason; slots disabled by hand never come back.
			const lock = jest.fn()
			const set = jest.fn()
			const update = jest.fn().mockReturnValue(updateAll(set))
			const tx = mockTransaction({
				select: jest
					.fn()
					.mockReturnValueOnce(selectRows([serviceCategory]))
					.mockReturnValueOnce(selectLockedOrdered([{ id: 7 }, { id: 9 }], lock)),
				update,
			})

			await expect(service.unblockDate(unblockInput, "staff-1")).resolves.toEqual({
				enabledCount: 2,
			})

			expect(lock).toHaveBeenCalledWith("update")
			expect(update).toHaveBeenCalledTimes(1)
			expect(set).toHaveBeenCalledWith(
				expect.objectContaining({ isDisabled: false, disabledReason: null })
			)
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "schedule.date.unblock",
					targetType: "schedule_date",
					targetId: "1:2:2026-12-02",
					newValue: expect.objectContaining({ enabledCount: 2 }),
				}),
				tx
			)
		})

		it("changes nothing when the date has no blocked slots", async () => {
			const update = jest.fn()
			mockTransaction({
				select: jest
					.fn()
					.mockReturnValueOnce(selectRows([serviceCategory]))
					.mockReturnValueOnce(selectLockedOrdered([])),
				update,
			})

			await expect(service.unblockDate(unblockInput, "staff-1")).resolves.toEqual({
				enabledCount: 0,
			})
			expect(update).not.toHaveBeenCalled()
		})

		it("refuses a user outside the Scope", async () => {
			jest.mocked(inScope).mockReturnValueOnce(false)
			const update = jest.fn()
			mockTransaction({
				select: jest.fn().mockReturnValueOnce(selectRows([serviceCategory])),
				update,
			})

			await expect(
				service.unblockDate(unblockInput, "staff-1", LIMITED_SCOPE)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(update).not.toHaveBeenCalled()
		})
	})

	describe("updateSlotCapacity", () => {
		it("changes the capacity under a row lock and audits old and new values", async () => {
			const current = makeSlot({ capacity: 20, bookedCount: 5 })
			const updated = { ...current, capacity: 10 }
			const lock = jest.fn()
			const set = jest.fn()
			const tx = mockTransaction({
				select: jest.fn().mockReturnValue(selectLocked([current], lock)),
				update: jest.fn().mockReturnValue(updateReturning([updated], set)),
			})

			await expect(service.updateSlotCapacity({ id: 7, capacity: 10 }, "staff-1")).resolves.toEqual(
				updated
			)

			expect(lock).toHaveBeenCalledWith("update")
			expect(set).toHaveBeenCalledWith(expect.objectContaining({ capacity: 10 }))
			expect(set.mock.calls[0]?.[0]).not.toHaveProperty("bookedCount")
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "schedules",
					action: "schedule.slot.capacity.update",
					actorId: "staff-1",
					targetType: "schedule_slot",
					targetId: "7",
					oldValue: expect.objectContaining({ capacity: 20, bookedCount: 5 }),
					newValue: expect.objectContaining({ capacity: 10, bookedCount: 5 }),
				}),
				tx
			)
		})

		it("allows lowering capacity to exactly the booked count", async () => {
			const current = makeSlot({ capacity: 20, bookedCount: 5 })
			mockTransaction({
				select: jest.fn().mockReturnValue(selectLocked([current])),
				update: jest.fn().mockReturnValue(updateReturning([{ ...current, capacity: 5 }])),
			})

			await expect(
				service.updateSlotCapacity({ id: 7, capacity: 5 }, "staff-1")
			).resolves.toMatchObject({ capacity: 5 })
		})

		it("refuses a capacity below the booked count and explains why", async () => {
			const update = jest.fn()
			mockTransaction({
				select: jest.fn().mockReturnValue(selectLocked([makeSlot({ bookedCount: 5 })])),
				update,
			})

			await expect(
				service.updateSlotCapacity({ id: 7, capacity: 4 }, "staff-1")
			).rejects.toMatchObject({
				code: "CONFLICT",
				message: "Capacity cannot be lower than the 5 bookings already made for this slot.",
			})
			expect(update).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		})

		it("returns not found for an unknown slot", async () => {
			mockTransaction({ select: jest.fn().mockReturnValue(selectLocked([])) })

			await expect(
				service.updateSlotCapacity({ id: 99, capacity: 10 }, "staff-1")
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(auditService.record).not.toHaveBeenCalled()
		})
	})

	describe("setSlotDisabled", () => {
		it("disables a slot, leaves its bookings alone, and audits it", async () => {
			const current = makeSlot({ bookedCount: 5 })
			const updated = { ...current, isDisabled: true }
			const set = jest.fn()
			const tx = mockTransaction({
				select: jest.fn().mockReturnValue(selectRows([current])),
				update: jest.fn().mockReturnValue(updateReturning([updated], set)),
			})

			await expect(
				service.setSlotDisabled({ id: 7, isDisabled: true }, "staff-1")
			).resolves.toMatchObject({ isDisabled: true, bookedCount: 5 })

			expect(set).toHaveBeenCalledWith(expect.objectContaining({ isDisabled: true }))
			expect(set.mock.calls[0]?.[0]).not.toHaveProperty("bookedCount")
			// Disabling by hand never writes a reason, so a date unblock leaves it disabled.
			expect(set.mock.calls[0]?.[0]).not.toHaveProperty("disabledReason")
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "schedule.slot.disable",
					targetId: "7",
					oldValue: expect.objectContaining({ isDisabled: false }),
					newValue: expect.objectContaining({ isDisabled: true }),
				}),
				tx
			)
		})

		it("re-enables a slot, clears any date-block reason, and audits it as schedule.slot.enable", async () => {
			const current = makeSlot({ isDisabled: true, disabledReason: "Holiday" })
			const set = jest.fn()
			const tx = mockTransaction({
				select: jest.fn().mockReturnValue(selectRows([current])),
				update: jest
					.fn()
					.mockReturnValue(
						updateReturning([{ ...current, isDisabled: false, disabledReason: null }], set)
					),
			})

			await service.setSlotDisabled({ id: 7, isDisabled: false }, "staff-1")

			expect(set).toHaveBeenCalledWith(
				expect.objectContaining({ isDisabled: false, disabledReason: null })
			)
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "schedule.slot.enable",
					oldValue: expect.objectContaining({ disabledReason: "Holiday" }),
					newValue: expect.objectContaining({ disabledReason: null }),
				}),
				tx
			)
		})

		it("returns not found for an unknown slot", async () => {
			mockTransaction({ select: jest.fn().mockReturnValue(selectRows([])) })

			await expect(
				service.setSlotDisabled({ id: 99, isDisabled: true }, "staff-1")
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(auditService.record).not.toHaveBeenCalled()
		})
	})

	describe("deleteSlot", () => {
		it("deletes a slot with no bookings and audits what was removed", async () => {
			const current = makeSlot()
			const where = jest.fn().mockResolvedValue(undefined)
			const lock = jest.fn()
			const tx = mockTransaction({
				select: jest.fn().mockReturnValue(selectLocked([current], lock)),
				delete: jest.fn().mockReturnValue({ where }),
			})

			await expect(service.deleteSlot(7, "staff-1")).resolves.toEqual({ success: true, id: 7 })

			expect(lock).toHaveBeenCalledWith("update")
			expect(where).toHaveBeenCalledTimes(1)
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "schedule.slot.delete",
					actorId: "staff-1",
					targetId: "7",
					oldValue: expect.objectContaining({ id: 7, capacity: 20 }),
					newValue: null,
				}),
				tx
			)
		})

		it("refuses to delete a slot with bookings and explains why", async () => {
			const remove = jest.fn()
			mockTransaction({
				select: jest.fn().mockReturnValue(selectLocked([makeSlot({ bookedCount: 1 })])),
				delete: remove,
			})

			await expect(service.deleteSlot(7, "staff-1")).rejects.toMatchObject({
				code: "CONFLICT",
				message: "This slot has 1 booking and cannot be deleted. Disable it instead.",
			})
			expect(remove).not.toHaveBeenCalled()
			expect(auditService.record).not.toHaveBeenCalled()
		})

		it("returns not found for an unknown slot", async () => {
			mockTransaction({ select: jest.fn().mockReturnValue(selectLocked([])) })

			await expect(service.deleteSlot(99, "staff-1")).rejects.toMatchObject({ code: "NOT_FOUND" })
		})
	})

	describe("listSlots", () => {
		it("returns the month's slots in start order", async () => {
			const rows = [makeSlot(), makeSlot({ id: 8, isDisabled: true })]
			const orderBy = jest.fn().mockResolvedValue(rows)
			const where = jest.fn().mockReturnValue({ orderBy })
			const from = jest.fn().mockReturnValue({ where })
			jest.mocked(db.select).mockReturnValue({ from } as never)

			await expect(
				service.listSlots({ serviceId: 1, locationId: 2, month: "2026-12" })
			).resolves.toEqual(rows)
			expect(from).toHaveBeenCalledWith(scheduleSlots)
			expect(where).toHaveBeenCalledTimes(1)
		})
	})

	describe("listAvailability", () => {
		it("returns remaining capacity per slot, with full and disabled slots unavailable", async () => {
			const rows = [
				{ slot: makeSlot({ id: 1, capacity: 20, bookedCount: 5 }) },
				{ slot: makeSlot({ id: 2, capacity: 20, bookedCount: 20 }) },
				{ slot: makeSlot({ id: 3, isDisabled: true }) },
			]
			const orderBy = jest.fn().mockResolvedValue(rows)
			const where = jest.fn().mockReturnValue({ orderBy })
			const innerJoin = jest.fn()
			innerJoin.mockReturnValue({ innerJoin, where })
			const from = jest.fn().mockReturnValue({ innerJoin })
			jest.mocked(db.select).mockReturnValue({ from } as never)

			const availability = await service.listAvailability(
				{ serviceId: 1, locationId: 2, month: "2026-12" },
				NOW
			)

			expect(
				availability.map(({ id, remainingCapacity, isAvailable }) => ({
					id,
					remainingCapacity,
					isAvailable,
				}))
			).toEqual([
				{ id: 1, remainingCapacity: 15, isAvailable: true },
				{ id: 2, remainingCapacity: 0, isAvailable: false },
				{ id: 3, remainingCapacity: 20, isAvailable: false },
			])
			// Joined to services and locations so a disabled one offers nothing.
			expect(innerJoin).toHaveBeenCalledTimes(2)
			// Clients never receive capacity or booked counts, only what is left.
			expect(availability[0]).not.toHaveProperty("capacity")
			expect(availability[0]).not.toHaveProperty("bookedCount")
		})
	})
})
