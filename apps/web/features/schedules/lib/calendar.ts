import { BUSINESS_TIMEZONE } from "@repo/contracts"

/**
 * Calendar helpers for the schedule screens.
 *
 * Slots are stored in UTC and shown in the business timezone, whatever
 * timezone the browser is in. Months are written "YYYY-MM" and dates
 * "YYYY-MM-DD", both as read on a Manila calendar.
 */

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
	timeZone: BUSINESS_TIMEZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
})

const timeFormatter = new Intl.DateTimeFormat("en-PH", {
	timeZone: BUSINESS_TIMEZONE,
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
})

const monthLabelFormatter = new Intl.DateTimeFormat("en-PH", {
	timeZone: "UTC",
	month: "long",
	year: "numeric",
})

const dateLabelFormatter = new Intl.DateTimeFormat("en-PH", {
	timeZone: "UTC",
	weekday: "long",
	day: "numeric",
	month: "long",
	year: "numeric",
})

const pad = (value: number) => String(value).padStart(2, "0")

function monthParts(month: string): { year: number; monthNumber: number } {
	const [year = 0, monthNumber = 1] = month.split("-").map(Number)
	return { year, monthNumber }
}

/** The Manila calendar date an instant falls on, "YYYY-MM-DD". */
export function manilaDateKey(instant: Date): string {
	return dateKeyFormatter.format(instant)
}

/** The Manila time of day of an instant, for example "8:00 AM". */
export function manilaTime(instant: Date): string {
	return timeFormatter.format(instant)
}

/** A slot's time window, for example "8:00 AM – 10:00 AM". */
export function slotTimeRange(slot: { startsAt: Date; endsAt: Date }): string {
	return `${manilaTime(slot.startsAt)} – ${manilaTime(slot.endsAt)}`
}

/** The Manila month an instant falls in, "YYYY-MM". */
export function manilaMonthOf(instant: Date): string {
	return manilaDateKey(instant).slice(0, 7)
}

/** The month `delta` months after (or before, when negative) the given month. */
export function shiftMonth(month: string, delta: number): string {
	const { year, monthNumber } = monthParts(month)
	const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`
}

/** A month's display name, for example "December 2026". */
export function monthLabel(month: string): string {
	const { year, monthNumber } = monthParts(month)
	return monthLabelFormatter.format(new Date(Date.UTC(year, monthNumber - 1, 1)))
}

/** A date's display name, for example "Wednesday, December 2, 2026". */
export function dateLabel(date: string): string {
	const [year = 0, monthNumber = 1, day = 1] = date.split("-").map(Number)
	return dateLabelFormatter.format(new Date(Date.UTC(year, monthNumber - 1, day)))
}

export interface CalendarDay {
	/** "YYYY-MM-DD" */
	date: string
	/** Day of the month, 1 to 31. */
	day: number
}

/**
 * A month laid out as weeks from Sunday to Saturday. Cells before the 1st and
 * after the last day are null, so every week has exactly seven cells.
 */
export function monthGrid(month: string): (CalendarDay | null)[][] {
	const { year, monthNumber } = monthParts(month)
	const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
	const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()

	const cells: (CalendarDay | null)[] = Array.from({ length: firstWeekday }, () => null)
	for (let day = 1; day <= daysInMonth; day++) {
		cells.push({ date: `${year}-${pad(monthNumber)}-${pad(day)}`, day })
	}
	while (cells.length % 7 !== 0) cells.push(null)

	const weeks: (CalendarDay | null)[][] = []
	for (let index = 0; index < cells.length; index += 7) {
		weeks.push(cells.slice(index, index + 7))
	}
	return weeks
}

/** Slots grouped by the Manila date they start on, each day's slots in start order. */
export function groupSlotsByDate<T extends { startsAt: Date }>(
	slots: readonly T[]
): Map<string, T[]> {
	const byDate = new Map<string, T[]>()
	const inOrder = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
	for (const slot of inOrder) {
		const key = manilaDateKey(slot.startsAt)
		const day = byDate.get(key)
		if (day) day.push(slot)
		else byDate.set(key, [slot])
	}
	return byDate
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
