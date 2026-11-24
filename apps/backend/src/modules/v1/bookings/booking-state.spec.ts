import { canTransition, initialStatus, isTerminal, toClientBookingStatus } from "./booking-state"

describe("booking state machine", () => {
	it("starts a regular booking awaiting payment and an expedite request awaiting approval", () => {
		expect(initialStatus("regular")).toBe("pending_payment")
		expect(initialStatus("vip")).toBe("pending_payment")
		expect(initialStatus("walk-in")).toBe("pending_payment")
		expect(initialStatus("expedite")).toBe("pending_approval")
	})

	it.each([
		["pending_approval", "pending_payment"],
		["pending_approval", "rejected"],
		["pending_payment", "paid"],
		["pending_payment", "cancelled"],
		["paid", "completed"],
		["paid", "forfeited"],
		["paid", "refund_requested"],
		["refund_requested", "refunded"],
	] as const)("allows %s to %s", (from, to) => {
		expect(canTransition(from, to)).toBe(true)
	})

	it.each([
		["pending_payment", "completed"],
		["pending_payment", "refunded"],
		["paid", "pending_payment"],
		["paid", "cancelled"],
		["cancelled", "pending_payment"],
		["completed", "paid"],
		["refunded", "paid"],
		["pending_approval", "paid"],
	] as const)("refuses %s to %s", (from, to) => {
		expect(canTransition(from, to)).toBe(false)
	})

	it("treats completed, cancelled, rejected, forfeited and refunded as final", () => {
		for (const status of ["completed", "cancelled", "rejected", "forfeited", "refunded"] as const) {
			expect(isTerminal(status)).toBe(true)
		}
		for (const status of [
			"pending_approval",
			"pending_payment",
			"paid",
			"refund_requested",
		] as const) {
			expect(isTerminal(status)).toBe(false)
		}
	})
})

describe("toClientBookingStatus (BKG-4)", () => {
	it.each([
		["pending_approval", "Pending"],
		["pending_payment", "Pending"],
		["paid", "Paid"],
		["completed", "Paid"],
		["refund_requested", "Paid"],
		["cancelled", "Cancelled"],
		["rejected", "Cancelled"],
		["forfeited", "Cancelled"],
		["refunded", "Cancelled"],
	] as const)("shows %s as %s", (status, label) => {
		expect(toClientBookingStatus(status)).toBe(label)
	})
})
