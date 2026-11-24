import {
	applyBookingTransition,
	bookingHoldsCapacity,
	canTransitionBooking,
	InvalidBookingTransitionError,
	toClientBookingStatus,
} from "./booking-state"

describe("Booking state machine (DOMAIN-MODEL.md section 5.1)", () => {
	it("moves a pending_payment booking to paid and clears its hold", () => {
		expect(
			applyBookingTransition("pending_payment", { to: "paid", holdExpiresAt: null })
		).toEqual({ status: "paid", holdExpiresAt: null })
	})

	it("moves a pending_payment booking to cancelled with reason, time and cleared hold", () => {
		const cancelledAt = new Date("2026-11-17T08:00:00.000Z")
		expect(
			applyBookingTransition("pending_payment", {
				to: "cancelled",
				cancelReason: "hold_expired",
				cancelledAt,
				holdExpiresAt: null,
			})
		).toEqual({
			status: "cancelled",
			cancelReason: "hold_expired",
			cancelledAt,
			holdExpiresAt: null,
		})
	})

	it("refuses transitions from terminal statuses (cancelled, completed, refunded, forfeited, rejected)", () => {
		for (const terminal of ["cancelled", "completed", "refunded", "forfeited", "rejected"] as const) {
			expect(canTransitionBooking(terminal, "paid")).toBe(false)
			expect(canTransitionBooking(terminal, "cancelled")).toBe(false)
			expect(() => applyBookingTransition(terminal, { to: "paid", holdExpiresAt: null })).toThrow(
				InvalidBookingTransitionError
			)
		}
	})

	it("refuses cancelling a paid booking directly (paid uses refund_requested or forfeited)", () => {
		expect(canTransitionBooking("paid", "cancelled")).toBe(false)
		expect(canTransitionBooking("paid", "completed")).toBe(true)
		expect(canTransitionBooking("paid", "forfeited")).toBe(true)
		expect(canTransitionBooking("paid", "refund_requested")).toBe(true)
	})

	it("reports whether a booking still holds slot capacity", () => {
		expect(bookingHoldsCapacity("pending_payment")).toBe(true)
		expect(bookingHoldsCapacity("paid")).toBe(true)
		expect(bookingHoldsCapacity("cancelled")).toBe(false)
		expect(bookingHoldsCapacity("completed")).toBe(false)
	})

	describe("toClientBookingStatus (BKG-4)", () => {
		it.each([
			["pending_approval", "Pending"],
			["pending_payment", "Pending"],
			["paid", "Paid"],
			["completed", "Paid"],
			["cancelled", "Cancelled"],
			["rejected", "Cancelled"],
			["forfeited", "Cancelled"],
			["refund_requested", "Cancelled"],
			["refunded", "Cancelled"],
		] as const)("maps %s to %s", (internalStatus, expectedLabel) => {
			expect(toClientBookingStatus(internalStatus)).toBe(expectedLabel)
		})
	})
})