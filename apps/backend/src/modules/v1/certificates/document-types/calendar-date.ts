/** "2026-11-19" → "November 19, 2026". Dates are calendar dates, so no timezone shift. */
export function formatCalendarDate(date: string | null): string {
	if (!date) return "-"
	const [year, month, day] = date.split("-").map(Number)
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)))
}

const SHORT_MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const

/**
 * "2026-11-19" → "19 Nov 2026" (CRT-3). The short form for the pre-printed
 * card, whose date boxes are too narrow for the long form. No timezone shift.
 */
export function formatCardDate(date: string | null): string {
	if (!date) return "-"
	const [year, month, day] = date.split("-").map(Number)
	const name = SHORT_MONTHS[(month ?? 1) - 1]
	if (!year || !day || !name) return date
	return `${day} ${name} ${year}`
}