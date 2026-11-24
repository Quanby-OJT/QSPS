import { reportPeriodBounds } from "./report-period"

describe("reportPeriodBounds", () => {
	it("uses Manila midnight for a day", () => {
		const result = reportPeriodBounds("day", "2026-11-24")

		expect(result.start.toISOString()).toBe("2026-11-23T16:00:00.000Z")
		expect(result.end.toISOString()).toBe("2026-11-24T16:00:00.000Z")
	})

	it("starts the week on Monday, even across a month boundary", () => {
		const result = reportPeriodBounds("week", "2026-03-01")

		expect(result.start.toISOString()).toBe("2026-02-22T16:00:00.000Z")
		expect(result.end.toISOString()).toBe("2026-03-01T16:00:00.000Z")
	})

	it("handles a leap-year month", () => {
		const result = reportPeriodBounds("month", "2028-02-15")

		expect(result.start.toISOString()).toBe("2028-01-31T16:00:00.000Z")
		expect(result.end.toISOString()).toBe("2028-02-29T16:00:00.000Z")
	})

	it("handles a year boundary", () => {
		const result = reportPeriodBounds("year", "2026-11-24")

		expect(result.start.toISOString()).toBe("2025-12-31T16:00:00.000Z")
		expect(result.end.toISOString()).toBe("2026-12-31T16:00:00.000Z")
	})

	it.each(["2026-02-29", "2026-13-01", "2026-11-31", "24-11-2026"])(
		"rejects invalid date %s",
		date => {
			expect(() => reportPeriodBounds("day", date)).toThrow()
		}
	)
})