import {
	eachDate,
	manilaDateOf,
	manilaDateTimeToUtc,
	manilaMonthRange,
	weekdayOf,
} from "./manila-time"

describe("manila-time", () => {
	describe("manilaDateTimeToUtc", () => {
		it("turns a Manila date and time into the UTC instant eight hours earlier", () => {
			expect(manilaDateTimeToUtc("2026-12-01", "08:00").toISOString()).toBe(
				"2026-12-01T00:00:00.000Z"
			)
			expect(manilaDateTimeToUtc("2026-07-15", "23:30").toISOString()).toBe(
				"2026-07-15T15:30:00.000Z"
			)
		})

		it("lands on the previous UTC day for early-morning Manila times", () => {
			expect(manilaDateTimeToUtc("2026-12-01", "00:00").toISOString()).toBe(
				"2026-11-30T16:00:00.000Z"
			)
		})
	})

	describe("manilaDateOf", () => {
		it("gives the Manila calendar date, which changes at 16:00 UTC", () => {
			expect(manilaDateOf(new Date("2026-11-30T15:59:59Z"))).toBe("2026-11-30")
			expect(manilaDateOf(new Date("2026-11-30T16:00:00Z"))).toBe("2026-12-01")
		})
	})

	describe("manilaMonthRange", () => {
		it("bounds a month by Manila midnight at each end", () => {
			const { start, end } = manilaMonthRange("2026-12")
			expect(start.toISOString()).toBe("2026-11-30T16:00:00.000Z")
			expect(end.toISOString()).toBe("2026-12-31T16:00:00.000Z")
		})

		it("handles a leap-year February", () => {
			const { start, end } = manilaMonthRange("2028-02")
			expect(start.toISOString()).toBe("2028-01-31T16:00:00.000Z")
			expect(end.toISOString()).toBe("2028-02-29T16:00:00.000Z")
		})
	})

	describe("weekdayOf", () => {
		it("returns 0 for Sunday through 6 for Saturday", () => {
			expect(weekdayOf("2026-11-29")).toBe(0)
			expect(weekdayOf("2026-12-01")).toBe(2)
			expect(weekdayOf("2026-12-05")).toBe(6)
		})
	})

	describe("eachDate", () => {
		it("lists every date in the range, both ends included", () => {
			expect(eachDate("2026-12-30", "2027-01-02")).toEqual([
				"2026-12-30",
				"2026-12-31",
				"2027-01-01",
				"2027-01-02",
			])
		})

		it("returns one date when the range is a single day", () => {
			expect(eachDate("2026-12-01", "2026-12-01")).toEqual(["2026-12-01"])
		})
	})
})
