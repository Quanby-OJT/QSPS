import { describe, expect, it } from "vitest"

import { BookingSchema, CreateBookingSchema, ReferenceNumberSchema } from "./bookings.schema.js"

describe("booking schemas", () => {
	it("accepts a slot id and rejects anything that is not a positive whole number", () => {
		expect(CreateBookingSchema.parse({ scheduleSlotId: 7 })).toEqual({
			scheduleSlotId: 7,
			acceptedPolicyDocumentIds: [],
		})
		expect(CreateBookingSchema.safeParse({ scheduleSlotId: 0 }).success).toBe(false)
		expect(CreateBookingSchema.safeParse({ scheduleSlotId: 1.5 }).success).toBe(false)
		expect(CreateBookingSchema.safeParse({}).success).toBe(false)
	})

	it("takes the accepted policy versions, once each (ADM-9)", () => {
		expect(
			CreateBookingSchema.parse({ scheduleSlotId: 7, acceptedPolicyDocumentIds: [3, 5, 3] })
		).toEqual({ scheduleSlotId: 7, acceptedPolicyDocumentIds: [3, 5] })
		expect(
			CreateBookingSchema.safeParse({ scheduleSlotId: 7, acceptedPolicyDocumentIds: [0] }).success
		).toBe(false)
	})

	it("accepts reference numbers written QSPS-YYMMDD-XXXXXX only", () => {
		expect(ReferenceNumberSchema.safeParse("QSPS-261117-AB12CD").success).toBe(true)
		expect(ReferenceNumberSchema.safeParse("QSPS-261117-ab12cd").success).toBe(false)
		expect(ReferenceNumberSchema.safeParse("QSPS-2611-AB12CD").success).toBe(false)
		expect(ReferenceNumberSchema.safeParse("BOQ-261117-AB12CD").success).toBe(false)
	})

	it("turns date text in a booking response back into dates", () => {
		const booking = BookingSchema.parse({
			id: 1,
			referenceNumber: "QSPS-261117-AB12CD",
			status: "pending_payment",
			kind: "regular",
			totalCentavos: 150000,
			holdExpiresAt: "2026-11-17T08:00:00.000Z",
			createdAt: "2026-11-17T07:00:00.000Z",
			items: [
				{
					id: 1,
					serviceId: 1,
					serviceName: "Yellow fever vaccination",
					locationId: 2,
					locationName: "Manila",
					scheduleSlotId: 7,
					startsAt: "2026-12-02T00:00:00.000Z",
					endsAt: "2026-12-02T04:00:00.000Z",
					feeCentavos: 150000,
					status: "booked",
				},
			],
		})

		expect(booking.holdExpiresAt).toEqual(new Date("2026-11-17T08:00:00.000Z"))
		expect(booking.items[0]?.startsAt).toEqual(new Date("2026-12-02T00:00:00.000Z"))
	})

	it("rejects a booking with an unknown status or no items", () => {
		const base = {
			id: 1,
			referenceNumber: "QSPS-261117-AB12CD",
			status: "pending_payment",
			kind: "regular",
			totalCentavos: 0,
			holdExpiresAt: null,
			createdAt: new Date(),
			items: [],
		}
		expect(BookingSchema.safeParse(base).success).toBe(false)
		expect(BookingSchema.safeParse({ ...base, status: "unpaid" }).success).toBe(false)
	})
})
