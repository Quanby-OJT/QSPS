import { hasExpired } from "./document-expiry"

describe("hasExpired (CRT-5)", () => {
	const VALID_UNTIL = "2026-11-19"

	it("never expires when there is no valid-until date", () => {
		expect(hasExpired(null, new Date("2099-01-01T00:00:00.000Z"))).toBe(false)
	})

	it("is valid the day before the valid-until date", () => {
		// 18 Nov 2026, 13:00 in Manila
		expect(hasExpired(VALID_UNTIL, new Date("2026-11-18T05:00:00.000Z"))).toBe(false)
	})

	it("is still valid on the valid-until date, up to its last minute in Manila", () => {
		// 19 Nov 2026, 00:00 in Manila is 18 Nov 16:00 UTC
		expect(hasExpired(VALID_UNTIL, new Date("2026-11-18T16:00:00.000Z"))).toBe(false)
		// 19 Nov 2026, 23:59 in Manila
		expect(hasExpired(VALID_UNTIL, new Date("2026-11-19T15:59:00.000Z"))).toBe(false)
	})

	it("is expired from the first minute of the next day in Manila", () => {
		// 20 Nov 2026, 00:00 in Manila is 19 Nov 16:00 UTC
		expect(hasExpired(VALID_UNTIL, new Date("2026-11-19T16:00:00.000Z"))).toBe(true)
	})

	it("is expired long after the valid-until date", () => {
		expect(hasExpired(VALID_UNTIL, new Date("2027-06-01T00:00:00.000Z"))).toBe(true)
	})

	it("judges the date in Manila, not in UTC", () => {
		// 19 Nov 2026, 20:00 UTC is already 20 Nov in Manila (+8)
		expect(hasExpired(VALID_UNTIL, new Date("2026-11-19T20:00:00.000Z"))).toBe(true)
	})
})
