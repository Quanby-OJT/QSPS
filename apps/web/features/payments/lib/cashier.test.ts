import { describe, expect, it } from "vitest"

import { bookingStatusLabel, canCollect, checkAmountReceived } from "./cashier"

describe("cashier helpers (PAY-4)", () => {
	it("gives the change for cash above the amount due", () => {
		expect(checkAmountReceived("2000", 150000, "cash")).toEqual({
			ok: true,
			receivedCentavos: 200000,
			changeCentavos: 50000,
		})
	})

	it("accepts the exact amount for every tender", () => {
		for (const tender of ["cash", "card", "check"] as const) {
			expect(checkAmountReceived("1500.00", 150000, tender)).toMatchObject({ ok: true, changeCentavos: 0 })
		}
	})

	it("refuses less than the amount due", () => {
		expect(checkAmountReceived("1000", 150000, "cash")).toMatchObject({ ok: false })
	})

	it("refuses more than the amount due for card and check", () => {
		expect(checkAmountReceived("1600", 150000, "card")).toMatchObject({ ok: false })
		expect(checkAmountReceived("1600", 150000, "check")).toMatchObject({ ok: false })
	})

	it("refuses text that is not an amount", () => {
		expect(checkAmountReceived("abc", 150000, "cash")).toMatchObject({ ok: false })
		expect(checkAmountReceived("-5", 150000, "cash")).toMatchObject({ ok: false })
	})

	it("collects only a booking awaiting payment", () => {
		expect(canCollect({ status: "pending_payment" })).toBe(true)
		expect(canCollect({ status: "paid" })).toBe(false)
		expect(canCollect({ status: "cancelled" })).toBe(false)
	})

	it("names each status in plain words", () => {
		expect(bookingStatusLabel("pending_payment")).toBe("Awaiting payment")
		expect(bookingStatusLabel("cancelled")).toBe("Cancelled")
	})
})
