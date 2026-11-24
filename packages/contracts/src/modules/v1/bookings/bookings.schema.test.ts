import { describe, expect, it } from "vitest"

import {
	BOOKING_STATUSES,
	BookingDetailSchema,
	BookingIdParamSchema,
	BookingSchema,
	BookingSummarySchema,
	CLIENT_BOOKING_STATUSES,
	ClientBookingStatusSchema,
	CreateBookingSchema,
	MAX_BOOKING_ITEMS,
	MyBookingsResponseSchema,
	ReferenceNumberSchema,
} from "./bookings.schema.js"

const sampleItem = {
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
} as const

describe("booking schemas", () => {
	it("takes one or more slots as items (BKG-3)", () => {
		expect(CreateBookingSchema.parse({ items: [{ scheduleSlotId: 7 }] })).toEqual({
			items: [{ scheduleSlotId: 7 }],
			acceptedPolicyDocumentIds: [],
		})
		expect(
			CreateBookingSchema.parse({ items: [{ scheduleSlotId: 7 }, { scheduleSlotId: 9 }] }).items
		).toEqual([{ scheduleSlotId: 7 }, { scheduleSlotId: 9 }])
	})

	it("rejects an empty checkout, a bad slot id and the old single-slot shape", () => {
		expect(CreateBookingSchema.safeParse({ items: [] }).success).toBe(false)
		expect(CreateBookingSchema.safeParse({ items: [{ scheduleSlotId: 0 }] }).success).toBe(false)
		expect(CreateBookingSchema.safeParse({ items: [{ scheduleSlotId: 1.5 }] }).success).toBe(false)
		expect(CreateBookingSchema.safeParse({ scheduleSlotId: 7 }).success).toBe(false)
		expect(CreateBookingSchema.safeParse({}).success).toBe(false)
	})

	it("refuses the same slot twice and more than the most services per checkout", () => {
		expect(
			CreateBookingSchema.safeParse({ items: [{ scheduleSlotId: 7 }, { scheduleSlotId: 7 }] })
				.success
		).toBe(false)
		const items = (count: number) =>
			Array.from({ length: count }, (_, index) => ({ scheduleSlotId: index + 1 }))
		expect(CreateBookingSchema.safeParse({ items: items(MAX_BOOKING_ITEMS) }).success).toBe(true)
		expect(CreateBookingSchema.safeParse({ items: items(MAX_BOOKING_ITEMS + 1) }).success).toBe(
			false
		)
	})

	it("takes the accepted policy versions, once each (ADM-9)", () => {
		expect(
			CreateBookingSchema.parse({
				items: [{ scheduleSlotId: 7 }],
				acceptedPolicyDocumentIds: [3, 5, 3],
			})
		).toEqual({ items: [{ scheduleSlotId: 7 }], acceptedPolicyDocumentIds: [3, 5] })
		expect(
			CreateBookingSchema.safeParse({
				items: [{ scheduleSlotId: 7 }],
				acceptedPolicyDocumentIds: [0],
			}).success
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
			payOnsite: false,
			cancelReason: null,
			cancelledAt: null,
			createdAt: "2026-11-17T07:00:00.000Z",
			items: [sampleItem],
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
			payOnsite: false,
			cancelReason: null,
			cancelledAt: null,
			createdAt: new Date(),
			items: [],
		}
		expect(BookingSchema.safeParse(base).success).toBe(false)
		expect(BookingSchema.safeParse({ ...base, status: "unpaid" }).success).toBe(false)
	})

	it("takes the three cancel reasons only, with the cancel time as a date (BKG-2)", () => {
		const cancelled = {
			id: 1,
			referenceNumber: "QSPS-261117-AB12CD",
			status: "cancelled",
			kind: "regular",
			totalCentavos: 0,
			holdExpiresAt: null,
			payOnsite: true,
			cancelReason: "no_show",
			cancelledAt: "2026-11-17T09:00:00.000Z",
			createdAt: "2026-11-17T07:00:00.000Z",
			items: [
				{
					...sampleItem,
					feeCentavos: 0,
				},
			],
		}
		for (const reason of ["hold_expired", "no_show", "client_cancelled"]) {
			expect(BookingSchema.safeParse({ ...cancelled, cancelReason: reason }).success).toBe(true)
		}
		expect(BookingSchema.safeParse({ ...cancelled, cancelReason: "expired" }).success).toBe(false)
		expect(BookingSchema.parse(cancelled).cancelledAt).toEqual(new Date("2026-11-17T09:00:00.000Z"))
	})

	it("reads a booking id from the path (BKG-2, BKG-4)", () => {
		expect(BookingIdParamSchema.parse({ bookingId: "15" })).toEqual({ bookingId: 15 })
		expect(BookingIdParamSchema.safeParse({ bookingId: "0" }).success).toBe(false)
		expect(BookingIdParamSchema.safeParse({ bookingId: "abc" }).success).toBe(false)
	})

	describe("My Transactions & Booking Details schemas (BKG-4)", () => {
		it("accepts only Pending, Paid, and Cancelled as client-facing booking statuses", () => {
			expect(CLIENT_BOOKING_STATUSES).toEqual(["Pending", "Paid", "Cancelled"])
			for (const status of CLIENT_BOOKING_STATUSES) {
				expect(ClientBookingStatusSchema.safeParse(status).success).toBe(true)
			}
			expect(ClientBookingStatusSchema.safeParse("pending_payment").success).toBe(false)
			expect(BOOKING_STATUSES.length).toBe(9)
		})

		it("parses MyBookingsResponseSchema with date hydration", () => {
			const parsed = MyBookingsResponseSchema.parse({
				bookings: [
					{
						id: 31,
						referenceNumber: "QSPS-261122-AB12CD",
						status: "paid",
						clientStatus: "Paid",
						totalCentavos: 150000,
						payOnsite: false,
						holdExpiresAt: null,
						createdAt: "2026-11-22T07:00:00.000Z",
						items: [sampleItem],
					},
				],
			})
			expect(parsed.bookings).toHaveLength(1)
			expect(parsed.bookings[0]?.clientStatus).toBe("Paid")
			expect(parsed.bookings[0]?.createdAt).toEqual(new Date("2026-11-22T07:00:00.000Z"))
		})

		it("parses BookingDetailSchema with payment, receipt, and issued documents", () => {
			const detail = BookingDetailSchema.parse({
				id: 31,
				referenceNumber: "QSPS-261122-AB12CD",
				status: "completed",
				clientStatus: "Paid",
				kind: "regular",
				totalCentavos: 150000,
				holdExpiresAt: null,
				payOnsite: false,
				cancelReason: null,
				cancelledAt: null,
				createdAt: "2026-11-22T07:00:00.000Z",
				items: [{ ...sampleItem, status: "issued" }],
				payment: {
					id: 12,
					amountCentavos: 151500,
					convenienceFeeCentavos: 1500,
					providerCode: "fake",
					channelCode: "gcash",
					channelName: "GCash",
					status: "succeeded",
					paidAt: "2026-11-22T07:05:00.000Z",
					createdAt: "2026-11-22T07:04:00.000Z",
				},
				receipt: {
					id: 5,
					paymentId: 12,
					receiptNumber: "QSPS-R-261122-000001",
					verificationToken: "AbCdEfGhIjKlMnOpQrSt_-",
					issuedAt: "2026-11-22T07:05:00.000Z",
				},
				documents: [
					{
						id: 99,
						bookingItemId: 1,
						serviceName: "Yellow fever vaccination",
						documentType: "icv-record",
						documentNumber: "ICV-MNL-2026-000001",
						status: "valid",
						issuedAt: "2026-12-02T01:30:00.000Z",
						validUntil: null,
					},
				],
			})

			expect(detail.payment?.paidAt).toEqual(new Date("2026-11-22T07:05:00.000Z"))
			expect(detail.receipt?.issuedAt).toEqual(new Date("2026-11-22T07:05:00.000Z"))
			expect(detail.documents[0]?.issuedAt).toEqual(new Date("2026-12-02T01:30:00.000Z"))
		})
	})
})
