export type ReportPeriod = "day" | "week" | "month" | "year"

/**
 * Returns a half-open UTC interval for a calendar period in Asia/Manila.
 * Manila is UTC+08:00. Weeks start on Monday.
 */
export function reportPeriodBounds(
	period: ReportPeriod,
	date: string
): { start: Date; end: Date } {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
	if (!match) throw new Error("Date must use YYYY-MM-DD format")

	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])

	if (year < 1900 || year > 9998) {
		throw new Error("Date is outside the supported range")
	}

	const selected = new Date(Date.UTC(year, month - 1, day))
	if (
		selected.getUTCFullYear() !== year ||
		selected.getUTCMonth() !== month - 1 ||
		selected.getUTCDate() !== day
	) {
		throw new Error("Invalid calendar date")
	}

	const start = new Date(selected)
	const end = new Date(selected)

	switch (period) {
		case "day":
			end.setUTCDate(end.getUTCDate() + 1)
			break
		case "week": {
			const daysSinceMonday = (start.getUTCDay() + 6) % 7
			start.setUTCDate(start.getUTCDate() - daysSinceMonday)
			end.setTime(start.getTime())
			end.setUTCDate(end.getUTCDate() + 7)
			break
		}
		case "month":
			start.setUTCDate(1)
			end.setTime(start.getTime())
			end.setUTCMonth(end.getUTCMonth() + 1)
			break
		case "year":
			start.setUTCMonth(0, 1)
			end.setTime(start.getTime())
			end.setUTCFullYear(end.getUTCFullYear() + 1)
			break
		default:
			throw new Error("Invalid report period")
	}

	const manilaOffsetMs = 8 * 60 * 60 * 1000
	return {
		start: new Date(start.getTime() - manilaOffsetMs),
		end: new Date(end.getTime() - manilaOffsetMs),
	}
}