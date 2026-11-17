import { describe, expect, it } from "vitest"

import {
	BusinessDateSchema,
	BusinessMonthSchema,
	GenerateSlotsSchema,
	ListSlotsRequestSchema,
	MAX_GENERATE_DAYS,
	SetSlotDisabledRequestSchema,
	UpdateSlotCapacityRequestSchema,
} from "./schedules.schema.js"

const base = {
	serviceId: 1,
	locationId: 2,
	startDate: "2026-12-01",
	endDate: "2026-12-31",
	weekdays: [1, 2, 3, 4, 5],
	windows: [
		{ startTime: "08:00", endTime: "10:00" },
		{ startTime: "10:00", endTime: "12:00" },
	],
	capacity: 20,
}

describe("schedule schemas", () => {
	it("accepts a date range, weekdays, time windows and a capacity", () => {
		expect(GenerateSlotsSchema.parse(base)).toMatchObject({
			capacity: 20,
			weekdays: [1, 2, 3, 4, 5],
		})
	})

	it("accepts a single day", () => {
		expect(GenerateSlotsSchema.safeParse({ ...base, endDate: base.startDate }).success).toBe(true)
	})

	it("rejects dates that are malformed or do not exist", () => {
		expect(BusinessDateSchema.safeParse("2026-02-30").success).toBe(false)
		expect(BusinessDateSchema.safeParse("2026-2-3").success).toBe(false)
		expect(BusinessDateSchema.safeParse("02/03/2026").success).toBe(false)
		expect(BusinessDateSchema.safeParse("2028-02-29").success).toBe(true)
	})

	it("rejects an end date before the start date", () => {
		expect(GenerateSlotsSchema.safeParse({ ...base, endDate: "2026-11-30" }).success).toBe(false)
	})

	it(`rejects a range longer than ${MAX_GENERATE_DAYS} days`, () => {
		expect(
			GenerateSlotsSchema.safeParse({ ...base, startDate: "2026-01-01", endDate: "2027-01-01" })
				.success
		).toBe(true)
		expect(
			GenerateSlotsSchema.safeParse({ ...base, startDate: "2026-01-01", endDate: "2027-01-02" })
				.success
		).toBe(false)
	})

	it("rejects no weekdays, repeated weekdays and weekdays outside 0 to 6", () => {
		expect(GenerateSlotsSchema.safeParse({ ...base, weekdays: [] }).success).toBe(false)
		expect(GenerateSlotsSchema.safeParse({ ...base, weekdays: [1, 1] }).success).toBe(false)
		expect(GenerateSlotsSchema.safeParse({ ...base, weekdays: [7] }).success).toBe(false)
	})

	it("rejects a window that ends at or before its start", () => {
		const windows = [{ startTime: "10:00", endTime: "10:00" }]
		expect(GenerateSlotsSchema.safeParse({ ...base, windows }).success).toBe(false)
	})

	it("rejects overlapping windows but allows back-to-back ones", () => {
		const overlapping = [
			{ startTime: "08:00", endTime: "10:30" },
			{ startTime: "10:00", endTime: "12:00" },
		]
		expect(GenerateSlotsSchema.safeParse({ ...base, windows: overlapping }).success).toBe(false)
		expect(GenerateSlotsSchema.safeParse(base).success).toBe(true)
	})

	it("rejects times that are not on the 24-hour clock", () => {
		const windows = [{ startTime: "8:00", endTime: "24:00" }]
		expect(GenerateSlotsSchema.safeParse({ ...base, windows }).success).toBe(false)
	})

	it("rejects a capacity that is zero, negative or fractional", () => {
		expect(GenerateSlotsSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false)
		expect(GenerateSlotsSchema.safeParse({ ...base, capacity: -5 }).success).toBe(false)
		expect(GenerateSlotsSchema.safeParse({ ...base, capacity: 1.5 }).success).toBe(false)
		expect(UpdateSlotCapacityRequestSchema.safeParse({ id: 4, capacity: 0 }).success).toBe(false)
	})

	it("converts query and path values from text to numbers", () => {
		expect(
			ListSlotsRequestSchema.parse({ serviceId: "7", locationId: "3", month: "2026-12" })
		).toEqual({ serviceId: 7, locationId: 3, month: "2026-12" })
		expect(UpdateSlotCapacityRequestSchema.parse({ id: "9", capacity: 30 })).toEqual({
			id: 9,
			capacity: 30,
		})
		expect(SetSlotDisabledRequestSchema.parse({ id: "9", isDisabled: true })).toEqual({
			id: 9,
			isDisabled: true,
		})
	})

	it("rejects a month that is not written YYYY-MM", () => {
		expect(BusinessMonthSchema.safeParse("2026-13").success).toBe(false)
		expect(BusinessMonthSchema.safeParse("2026-1").success).toBe(false)
		expect(BusinessMonthSchema.safeParse("2026-01").success).toBe(true)
	})
})
