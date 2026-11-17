/**
 * Date maths for schedules, all in the business timezone.
 *
 * Admins type dates and times as they read them on a Manila clock; the database
 * stores UTC. Every conversion goes through this file so no code depends on the
 * server's own timezone. The offset is read from the runtime's timezone data
 * instead of assuming +08:00.
 *
 * The zone name matches `BUSINESS_TIMEZONE` in `@repo/contracts`. It is repeated
 * here because backend Jest cannot load that package's runtime exports.
 */
export const BUSINESS_TIMEZONE = "Asia/Manila"

const MS_PER_DAY = 86_400_000

const wallClockFormatter = new Intl.DateTimeFormat("en-CA", {
	timeZone: BUSINESS_TIMEZONE,
	hourCycle: "h23",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
})

/** The Manila wall-clock reading of an instant, as if those digits were UTC. */
function wallClockAsUtcMs(instant: Date): number {
	const parts: Record<string, number> = {}
	for (const part of wallClockFormatter.formatToParts(instant)) {
		if (part.type !== "literal") parts[part.type] = Number(part.value)
	}
	return Date.UTC(
		parts.year ?? 0,
		(parts.month ?? 1) - 1,
		parts.day ?? 1,
		parts.hour ?? 0,
		parts.minute ?? 0,
		parts.second ?? 0
	)
}

/** How far Manila's clock is ahead of UTC at an instant, in milliseconds. */
function offsetMs(instant: Date): number {
	const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000
	return wallClockAsUtcMs(new Date(wholeSeconds)) - wholeSeconds
}

/** Split "YYYY-MM-DD" into numbers. Callers validate the format first (Zod). */
function dateParts(date: string): { year: number; month: number; day: number } {
	const [year = 0, month = 1, day = 1] = date.split("-").map(Number)
	return { year, month, day }
}

function formatDate(utcMs: number): string {
	return new Date(utcMs).toISOString().slice(0, 10)
}

/**
 * The UTC instant for a Manila calendar date and time of day.
 *
 * @param date "YYYY-MM-DD" in Manila
 * @param time "HH:mm" in Manila, 24-hour clock
 */
export function manilaDateTimeToUtc(date: string, time: string): Date {
	const { year, month, day } = dateParts(date)
	const [hour = 0, minute = 0] = time.split(":").map(Number)
	const asIfUtc = Date.UTC(year, month - 1, day, hour, minute)
	const firstGuess = asIfUtc - offsetMs(new Date(asIfUtc))
	// Checked again at the result, so a zone whose offset changes still lands right.
	return new Date(asIfUtc - offsetMs(new Date(firstGuess)))
}

/** The Manila calendar date ("YYYY-MM-DD") an instant falls on. */
export function manilaDateOf(instant: Date): string {
	return formatDate(wallClockAsUtcMs(instant))
}

/** The UTC instants that bound a Manila month: from `start` up to, not including, `end`. */
export function manilaMonthRange(month: string): { start: Date; end: Date } {
	const [year = 0, monthNumber = 1] = month.split("-").map(Number)
	const nextYear = monthNumber === 12 ? year + 1 : year
	const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
	const pad = (value: number) => String(value).padStart(2, "0")
	return {
		start: manilaDateTimeToUtc(`${year}-${pad(monthNumber)}-01`, "00:00"),
		end: manilaDateTimeToUtc(`${nextYear}-${pad(nextMonth)}-01`, "00:00"),
	}
}

/** Day of the week for a calendar date: 0 is Sunday and 6 is Saturday. */
export function weekdayOf(date: string): number {
	const { year, month, day } = dateParts(date)
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Every calendar date from `startDate` to `endDate`, both included. */
export function eachDate(startDate: string, endDate: string): string[] {
	const start = dateParts(startDate)
	const end = dateParts(endDate)
	const startMs = Date.UTC(start.year, start.month - 1, start.day)
	const endMs = Date.UTC(end.year, end.month - 1, end.day)
	const dates: string[] = []
	for (let ms = startMs; ms <= endMs; ms += MS_PER_DAY) {
		dates.push(formatDate(ms))
	}
	return dates
}
