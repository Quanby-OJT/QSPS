import { describe, expect, it } from "vitest"

import {
	dateLabel,
	groupSlotsByDate,
	manilaDateKey,
	manilaMonthOf,
	manilaTime,
	monthGrid,
	monthLabel,
	shiftMonth,
	slotTimeRange,
} from "./calendar"

describe("manilaDateKey", () => {
	it("gives the Manila date, which changes at 16:00 UTC", () => {
		expect(manilaDateKey(new Date("2026-11-30T15:59:00Z"))).toBe("2026-11-30")
		expect(manilaDateKey(new Date("2026-11-30T16:00:00Z"))).toBe("2026-12-01")
	})
})

describe("manilaMonthOf", () => {
	it("gives the Manila month even when UTC is still in the previous month", () => {
		expect(manilaMonthOf(new Date("2026-11-30T16:00:00Z"))).toBe("2026-12")
	})
})

describe("manilaTime and slotTimeRange", () => {
	it("shows times on a Manila clock", () => {
		expect(manilaTime(new Date("2026-12-02T00:00:00Z"))).toMatch(/^8:00\s?AM$/i)
		expect(manilaTime(new Date("2026-12-02T05:30:00Z"))).toMatch(/^1:30\s?PM$/i)
	})

	it("joins the start and end of a slot", () => {
		const range = slotTimeRange({
			startsAt: new Date("2026-12-02T00:00:00Z"),
			endsAt: new Date("2026-12-02T02:00:00Z"),
		})
		expect(range).toMatch(/^8:00\s?AM – 10:00\s?AM$/i)
	})
})

describe("shiftMonth", () => {
	it("moves forward and back across a year boundary", () => {
		expect(shiftMonth("2026-12", 1)).toBe("2027-01")
		expect(shiftMonth("2027-01", -1)).toBe("2026-12")
		expect(shiftMonth("2026-12", -12)).toBe("2025-12")
		expect(shiftMonth("2026-06", 0)).toBe("2026-06")
	})
})

describe("monthLabel and dateLabel", () => {
	it("names the month and year", () => {
		expect(monthLabel("2026-12")).toContain("December")
		expect(monthLabel("2026-12")).toContain("2026")
	})

	it("names the weekday and date", () => {
		expect(dateLabel("2026-12-02")).toContain("Wednesday")
		expect(dateLabel("2026-12-02")).toContain("December")
	})
})

describe("monthGrid", () => {
	it("lays December 2026 out from Sunday to Saturday with empty cells at both ends", () => {
		const weeks = monthGrid("2026-12")

		expect(weeks).toHaveLength(5)
		expect(weeks.every(week => week.length === 7)).toBe(true)
		// 1 December 2026 is a Tuesday.
		expect(weeks[0]?.map(cell => cell?.day ?? null)).toEqual([null, null, 1, 2, 3, 4, 5])
		expect(weeks[4]?.map(cell => cell?.day ?? null)).toEqual([27, 28, 29, 30, 31, null, null])
		expect(weeks[0]?.[2]).toEqual({ date: "2026-12-01", day: 1 })
	})

	it("fits February 2026 in exactly four weeks", () => {
		const weeks = monthGrid("2026-02")

		expect(weeks).toHaveLength(4)
		expect(weeks[0]?.[0]).toEqual({ date: "2026-02-01", day: 1 })
		expect(weeks[3]?.[6]).toEqual({ date: "2026-02-28", day: 28 })
	})

	it("includes 29 February in a leap year", () => {
		const days = monthGrid("2028-02")
			.flat()
			.filter(cell => cell !== null)
		expect(days).toHaveLength(29)
	})
})

describe("groupSlotsByDate", () => {
	it("groups by Manila date and sorts each day by start time", () => {
		const slots = [
			{ id: 2, startsAt: new Date("2026-12-02T02:00:00Z") },
			{ id: 1, startsAt: new Date("2026-12-02T00:00:00Z") },
			// 00:30 on 3 December in Manila, though still 2 December in UTC.
			{ id: 3, startsAt: new Date("2026-12-02T16:30:00Z") },
		]

		const grouped = groupSlotsByDate(slots)

		expect([...grouped.keys()]).toEqual(["2026-12-02", "2026-12-03"])
		expect(grouped.get("2026-12-02")?.map(slot => slot.id)).toEqual([1, 2])
		expect(grouped.get("2026-12-03")?.map(slot => slot.id)).toEqual([3])
	})
})
