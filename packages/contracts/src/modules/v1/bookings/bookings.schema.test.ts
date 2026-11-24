import { describe, expect, it } from "vitest"

import {
	BookingIdParamSchema,
	BookingItemSchema,
	CreateBookingSchema,
	MAX_BOOKING_ITEMS,
	RescheduleBookingItemSchema,
	UpdateBookingItemFormSchema,
} from "./bookings.schema.js"

describe("CreateBookingSchema (BKG-1, BKG-3)", () => {
	it("accepts one slot or several distinct slots", () => {
		expect(CreateBookingSchema.parse({ items: [{ scheduleSlotId: 7 }] })).toEqual({
			items: [{ scheduleSlotId: 7 }],
			acceptedPolicyDocumentIds: [],
		})
		expect(
			CreateBookingSchema.parse({ items: [{ scheduleSlotId: 7 }, { scheduleSlotId: 9 }] })
		).toEqual({
			items: [{ scheduleSlotId: 7 }, { scheduleSlotId: 9 }],
			acceptedPolicyDocumentIds: [],
		})
	})

	it("rejects an empty cart, too many items, or duplicate slots", () => {
		expect(CreateBookingSchema.safeParse({ items: [] }).success).toBe(false)
		expect(
			CreateBookingSchema.safeParse({
				items: Array.from({ length: MAX_BOOKING_ITEMS + 1 }, (_, i) => ({
					scheduleSlotId: i + 1,
				})),
			}).success
		).toBe(false)
		expect(
			CreateBookingSchema.safeParse({
				items: [{ scheduleSlotId: 7 }, { scheduleSlotId: 7 }],
			}).success
		).toBe(false)
	})

	it("rejects non-positive or non-integer slot ids", () => {
		expect(CreateBookingSchema.safeParse({ items: [{ scheduleSlotId: 0 }] }).success).toBe(false)
		expect(CreateBookingSchema.safeParse({ items: [{ scheduleSlotId: -3 }] }).success).toBe(false)
		expect(CreateBookingSchema.safeParse({ items: [{ scheduleSlotId: 1.5 }] }).success).toBe(false)
	})
})

describe("BookingIdParamSchema (BKG-2, BKG-5)", () => {
	it("requires a positive integer booking id", () => {
		expect(BookingIdParamSchema.parse({ bookingId: "12" })).toEqual({ bookingId: 12 })
		expect(BookingIdParamSchema.safeParse({ bookingId: 0 }).success).toBe(false)
		expect(BookingIdParamSchema.safeParse({ bookingId: -1 }).success).toBe(false)
		expect(BookingIdParamSchema.safeParse({ bookingId: 1.2 }).success).toBe(false)
	})
})

describe("RescheduleBookingItemSchema & BookingItemSchema (BKG-5)", () => {
	it("accepts positive integer booking, item and target schedule slot ids", () => {
		expect(
			RescheduleBookingItemSchema.parse({
				bookingId: "12",
				bookingItemId: "44",
				scheduleSlotId: 99,
			})
		).toEqual({
			bookingId: 12,
			bookingItemId: 44,
			scheduleSlotId: 99,
		})
	})

	it("rejects non-positive or non-integer ids", () => {
		expect(
			RescheduleBookingItemSchema.safeParse({
				bookingId: 0,
				bookingItemId: 44,
				scheduleSlotId: 99,
			}).success
		).toBe(false)
		expect(
			RescheduleBookingItemSchema.safeParse({
				bookingId: 12,
				bookingItemId: -1,
				scheduleSlotId: 99,
			}).success
		).toBe(false)
		expect(
			RescheduleBookingItemSchema.safeParse({
				bookingId: 12,
				bookingItemId: 44,
				scheduleSlotId: 1.5,
			}).success
		).toBe(false)
	})

	it("validates non-negative rescheduleCount on BookingItemSchema", () => {
		const base = {
			id: 44,
			serviceId: 1,
			serviceName: "Yellow fever vaccination",
			locationId: 2,
			locationName: "Manila",
			scheduleSlotId: 7,
			startsAt: new Date("2026-12-02T00:00:00.000Z"),
			endsAt: new Date("2026-12-02T04:00:00.000Z"),
			feeCentavos: 150000,
			rescheduleCount: 0,
			status: "booked" as const,
		}
		expect(BookingItemSchema.parse(base).rescheduleCount).toBe(0)
		expect(BookingItemSchema.parse({ ...base, rescheduleCount: 2 }).rescheduleCount).toBe(2)
		expect(BookingItemSchema.safeParse({ ...base, rescheduleCount: -1 }).success).toBe(false)
	})
})

describe("UpdateBookingItemFormSchema (FRM-2)", () => {
	it("accepts a booking, item, template id and answers map", () => {
		expect(
			UpdateBookingItemFormSchema.parse({
				bookingId: 12,
				bookingItemId: 44,
				formTemplateId: 11,
				answers: { "100": "Ana Santos", "101": ["Passport"] },
			})
		).toEqual({
			bookingId: 12,
			bookingItemId: 44,
			formTemplateId: 11,
			answers: { "100": "Ana Santos", "101": ["Passport"] },
		})
	})
})