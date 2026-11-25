import { bookingItems, scheduleSlots } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"

import type { BookingStatus } from "@repo/contracts"
import { BookingService } from "./bookings.service"

jest.mock("@orpc/contract", () => {
	const chain = new Proxy(
		{},
		{
			get: (_target, prop) => (prop === "then" ? undefined : () => chain),
		}
	)
	return { oc: chain }
})

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		code: string
		data?: unknown
		constructor(code: string, options?: { message?: string; data?: unknown }) {
			super(options?.message ?? code)
			this.name = "ORPCError"
			this.code = code
			this.data = options?.data
		}
	},
}))

const NOW = new Date("2026-11-22T06:00:00.000Z")
const CLIENT_ID = "user-client-1"

const OLD_SLOT = {
	id: 20,
	serviceId: 1,
	locationId: 2,
	startsAt: new Date("2026-11-25T08:00:00.000Z"), // 74h after NOW
	endsAt: new Date("2026-11-25T12:00:00.000Z"),
	capacity: 10,
	bookedCount: 4,
	isDisabled: false,
	createdAt: NOW,
	updatedAt: NOW,
}

const NEW_SLOT = {
	id: 9, // intentionally lower ID than OLD_SLOT to verify ascending lock order (Flow B)
	serviceId: 1,
	locationId: 2,
	startsAt: new Date("2026-11-27T08:00:00.000Z"),
	endsAt: new Date("2026-11-27T12:00:00.000Z"),
	capacity: 10,
	bookedCount: 2,
	isDisabled: false,
	createdAt: NOW,
	updatedAt: NOW,
}

const BOOKING_ROW: {
	id: number
	referenceNumber: string
	clientId: string
	status: BookingStatus
	kind: "regular"
	totalCentavos: number
	holdExpiresAt: Date | null
	payOnsite: boolean
	cancelReason: null
	cancelledAt: null
	createdAt: Date
	updatedAt: Date
} = {
	id: 31,
	referenceNumber: "QSPS-261122-AB12CD",
	clientId: CLIENT_ID,
	status: "paid",
	kind: "regular",
	totalCentavos: 150000,
	holdExpiresAt: null,
	payOnsite: false,
	cancelReason: null,
	cancelledAt: null,
	createdAt: NOW,
	updatedAt: NOW,
}

const ITEM_ROW = {
	id: 44,
	bookingId: 31,
	serviceId: 1,
	locationId: 2,
	scheduleSlotId: OLD_SLOT.id,
	feeCentavos: 150000,
	rescheduleCount: 0,
	status: "booked" as const,
	createdAt: NOW,
	updatedAt: NOW,
}

interface HarnessOptions {
	booking?: typeof BOOKING_ROW | null
	item?: typeof ITEM_ROW | null
	slots?: (typeof OLD_SLOT)[]
	policies?: Record<string, number>
}

function createHarness(options: HarnessOptions = {}) {
	const booking = "booking" in options ? options.booking : BOOKING_ROW
	const item = "item" in options ? options.item : ITEM_ROW
	const slots = options.slots ?? [NEW_SLOT, OLD_SLOT]
	const policies: Record<string, number> = {
		"booking.max_reschedules": 2,
		"booking.reschedule_min_hours_before": 24,
		...options.policies,
	}

	const updates: { table: unknown; values: Record<string, unknown> }[] = []
	let slotOrderByCalled = false
	let slotForUpdateCalled = false

	let selectCall = 0
	const tx = {
		select: jest.fn().mockImplementation(() => {
			selectCall += 1
			if (selectCall === 1) {
				return {
					from: () => ({
						where: () => ({
							for: () => Promise.resolve(booking ? [booking] : []),
						}),
					}),
				}
			}
			if (selectCall === 2) {
				return {
					from: () => ({
						where: () => ({
							for: () => Promise.resolve(item ? [item] : []),
						}),
					}),
				}
			}
			return {
				from: () => ({
					where: () => ({
						orderBy: () => {
							slotOrderByCalled = true
							return {
								for: () => {
									slotForUpdateCalled = true
									return Promise.resolve([...slots].sort((a, b) => a.id - b.id))
								},
							}
						},
					}),
				}),
			}
		}),
		update: jest.fn().mockImplementation((table: unknown) => ({
			set: (values: Record<string, unknown>) => ({
				where: () => {
					updates.push({ table, values })
					return Promise.resolve()
				},
			}),
		})),
	}

	jest
		.spyOn(db, "transaction")
		.mockImplementation((async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) as never)

	let postTxSelectCall = 0
	jest.spyOn(db, "select").mockImplementation((() => {
		postTxSelectCall += 1
		if (postTxSelectCall === 1) {
			return {
				from: () => ({
					where: () => ({
						limit: () => Promise.resolve(booking ? [booking] : []),
					}),
				}),
			}
		}
		const activeSlot = slots.find(s => s.id === NEW_SLOT.id) ?? OLD_SLOT
		return {
			from: () => ({
				innerJoin: () => ({
					innerJoin: () => ({
						innerJoin: () => ({
							where: () => ({
								orderBy: () =>
									Promise.resolve([
										{
											id: ITEM_ROW.id,
											serviceId: 1,
											serviceName: "Yellow fever vaccination",
											locationId: 2,
											locationName: "Manila",
											scheduleSlotId: activeSlot.id,
											startsAt: activeSlot.startsAt,
											endsAt: activeSlot.endsAt,
											feeCentavos: 150000,
											rescheduleCount: (item?.rescheduleCount ?? 0) + 1,
											status: "booked",
										},
									]),
							}),
						}),
					}),
				}),
			}),
		}
	}) as never)

	const auditService = { record: jest.fn().mockResolvedValue(undefined) }
	const policyService = {
		get: jest.fn((key: string) => Promise.resolve(policies[key] ?? 0)),
	}

	const service = new BookingService(auditService as never, policyService as never)

	return {
		service,
		auditService,
		updates,
		wasSlotsOrderedAndLocked: () => slotOrderByCalled && slotForUpdateCalled,
	}
}

describe("BookingService.rescheduleItem (BKG-5)", () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	it("AC1 & AC4: moves a booked item to a new open slot, adjusts both booked_counts, increments rescheduleCount, records audit, and enqueues notification", async () => {
		const notifySpy = jest.spyOn(NotificationService, "enqueue").mockResolvedValue(undefined)
		const { service, auditService, updates, wasSlotsOrderedAndLocked } = createHarness()

		const result = await service.rescheduleItem(
			{ bookingId: 31, bookingItemId: 44, scheduleSlotId: NEW_SLOT.id },
			CLIENT_ID,
			NOW
		)

		expect(wasSlotsOrderedAndLocked()).toBe(true)
		expect(result.items[0]?.scheduleSlotId).toBe(NEW_SLOT.id)
		expect(result.items[0]?.rescheduleCount).toBe(1)

		const slotUpdates = updates.filter(u => u.table === scheduleSlots)
		const itemUpdates = updates.filter(u => u.table === bookingItems)
		expect(slotUpdates).toHaveLength(2)
		expect(itemUpdates).toHaveLength(1)
		expect(itemUpdates[0]?.values).toMatchObject({
			scheduleSlotId: NEW_SLOT.id,
			rescheduleCount: 1,
		})

		expect(auditService.record).toHaveBeenCalledTimes(1)
		const auditEntry = auditService.record.mock.calls[0]?.[0]
		expect(auditEntry).toMatchObject({
			domain: "bookings",
			action: "booking_item.reschedule",
			actorId: CLIENT_ID,
			targetType: "booking_item",
			targetId: "44",
			oldValue: {
				bookingId: 31,
				scheduleSlotId: OLD_SLOT.id,
				startsAt: OLD_SLOT.startsAt.toISOString(),
				endsAt: OLD_SLOT.endsAt.toISOString(),
				rescheduleCount: 0,
			},
			newValue: {
				bookingId: 31,
				scheduleSlotId: NEW_SLOT.id,
				startsAt: NEW_SLOT.startsAt.toISOString(),
				endsAt: NEW_SLOT.endsAt.toISOString(),
				rescheduleCount: 1,
			},
		})
		expect(JSON.stringify(auditEntry)).not.toContain("@")

		expect(notifySpy).toHaveBeenCalledTimes(1)
		expect(notifySpy.mock.calls[0]?.[1]).toBe(31)
		expect(notifySpy.mock.calls[0]?.[2]).toBe("booking_rescheduled")
		expect(notifySpy.mock.calls[0]?.[3]).toBe("booking-item:44:rescheduled:1")
	})

	it("AC1: also allows rescheduling an item on a pending_payment booking", async () => {
		jest.spyOn(NotificationService, "enqueue").mockResolvedValue(undefined)
		const { service } = createHarness({
			booking: {
				...BOOKING_ROW,
				status: "pending_payment",
				holdExpiresAt: new Date("2026-11-22T08:00:00.000Z"),
			},
		})

		const result = await service.rescheduleItem(
			{ bookingId: 31, bookingItemId: 44, scheduleSlotId: NEW_SLOT.id },
			CLIENT_ID,
			NOW
		)

		expect(result.items[0]?.scheduleSlotId).toBe(NEW_SLOT.id)
		expect(result.items[0]?.rescheduleCount).toBe(1)
	})

	it("AC2: refuses with 409 CONFLICT when booking.max_reschedules has been reached", async () => {
		const { service, updates } = createHarness({
			item: { ...ITEM_ROW, rescheduleCount: 2 },
			policies: { "booking.max_reschedules": 2 },
		})

		await expect(
			service.rescheduleItem(
				{ bookingId: 31, bookingItemId: 44, scheduleSlotId: NEW_SLOT.id },
				CLIENT_ID,
				NOW
			)
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: expect.stringContaining("maximum of 2 reschedules"),
		})
		expect(updates).toHaveLength(0)
	})

	it("AC2: refuses with 409 CONFLICT when current slot starts within booking.reschedule_min_hours_before", async () => {
		const tooCloseSlot = {
			...OLD_SLOT,
			startsAt: new Date(NOW.getTime() + 12 * 3_600_000),
			endsAt: new Date(NOW.getTime() + 16 * 3_600_000),
		}
		const { service, updates } = createHarness({
			slots: [NEW_SLOT, tooCloseSlot],
			policies: { "booking.reschedule_min_hours_before": 24 },
		})

		await expect(
			service.rescheduleItem(
				{ bookingId: 31, bookingItemId: 44, scheduleSlotId: NEW_SLOT.id },
				CLIENT_ID,
				NOW
			)
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: expect.stringContaining("at least 24 hours"),
		})
		expect(updates).toHaveLength(0)
	})

	it("AC3: refuses with 409 CONFLICT and leaves the item on its original slot if the new slot fills up before lock", async () => {
		const fullNewSlot = { ...NEW_SLOT, capacity: 10, bookedCount: 10 }
		const { service, updates } = createHarness({
			slots: [fullNewSlot, OLD_SLOT],
		})

		await expect(
			service.rescheduleItem(
				{ bookingId: 31, bookingItemId: 44, scheduleSlotId: fullNewSlot.id },
				CLIENT_ID,
				NOW
			)
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "The chosen schedule slot is full",
			data: { scheduleSlotId: fullNewSlot.id },
		})
		expect(updates).toHaveLength(0)
	})

	it("refuses with 400 BAD_REQUEST when the new slot is for a different service or location", async () => {
		const wrongLocationSlot = { ...NEW_SLOT, locationId: 99 }
		const { service, updates } = createHarness({
			slots: [wrongLocationSlot, OLD_SLOT],
		})

		await expect(
			service.rescheduleItem(
				{ bookingId: 31, bookingItemId: 44, scheduleSlotId: wrongLocationSlot.id },
				CLIENT_ID,
				NOW
			)
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "Rescheduling must use a slot for the same service and location",
		})
		expect(updates).toHaveLength(0)
	})

	it("returns 401 UNAUTHORIZED when unauthenticated and 404 NOT_FOUND with denied audit when owned by another client", async () => {
		await expect(
			createHarness().service.rescheduleItem(
				{ bookingId: 31, bookingItemId: 44, scheduleSlotId: NEW_SLOT.id },
				null,
				NOW
			)
		).rejects.toMatchObject({ code: "UNAUTHORIZED" })

		const { service, auditService, updates } = createHarness({
			booking: { ...BOOKING_ROW, clientId: "other-client" },
		})

		await expect(
			service.rescheduleItem(
				{ bookingId: 31, bookingItemId: 44, scheduleSlotId: NEW_SLOT.id },
				CLIENT_ID,
				NOW
			)
		).rejects.toMatchObject({ code: "NOT_FOUND" })
		expect(updates).toHaveLength(0)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "bookings",
				action: "booking_item.reschedule",
				outcome: "denied",
				reason: "not_owner",
			})
		)
	})
})