import { describe, expect, it } from "vitest"

import { BookingItemSchema, RescheduleBookingItemSchema } from "./bookings.schema.js"

describe("RescheduleBookingItemSchema and rescheduleCount (BKG-5)", () => {
    it("accepts positive integer booking, item and target slot ids", () => {
        expect(
            RescheduleBookingItemSchema.parse({ bookingId: "12", bookingItemId: "44", scheduleSlotId: 99 })
        ).toEqual({ bookingId: 12, bookingItemId: 44, scheduleSlotId: 99 })
    })

    it("refuses non-positive or non-integer ids", () => {
        for (const input of [
            { bookingId: 0, bookingItemId: 44, scheduleSlotId: 99 },
            { bookingId: 12, bookingItemId: -1, scheduleSlotId: 99 },
            { bookingId: 12, bookingItemId: 44, scheduleSlotId: 1.5 },
        ]) {
            expect(RescheduleBookingItemSchema.safeParse(input).success).toBe(false)
        }
    })

    it("needs a non-negative rescheduleCount on a booking item", () => {
        const item = {
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
        expect(BookingItemSchema.parse({ ...item, rescheduleCount: 2 }).rescheduleCount).toBe(2)
        expect(BookingItemSchema.safeParse({ ...item, rescheduleCount: -1 }).success).toBe(false)
    })
})