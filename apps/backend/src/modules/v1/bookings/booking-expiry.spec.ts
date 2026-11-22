import { expiryReason, IN_FLIGHT_PAYMENT_STATUSES } from "./booking-expiry"

describe("expiryReason (BKG-2)", () => {
	it("says hold_expired when the hold has passed", () => {
		expect(expiryReason({ holdExpired: true, pastArrivalCutoff: false })).toBe("hold_expired")
	})

	it("says no_show when only the arrival cutoff has passed", () => {
		expect(expiryReason({ holdExpired: false, pastArrivalCutoff: true })).toBe("no_show")
	})

	it("prefers hold_expired when both have passed", () => {
		expect(expiryReason({ holdExpired: true, pastArrivalCutoff: true })).toBe("hold_expired")
	})

	it("says nothing when neither has passed", () => {
		expect(expiryReason({ holdExpired: false, pastArrivalCutoff: false })).toBeNull()
	})

	it("treats only initiated and pending payments as still in flight", () => {
		expect(IN_FLIGHT_PAYMENT_STATUSES).toEqual(["initiated", "pending"])
	})
})
