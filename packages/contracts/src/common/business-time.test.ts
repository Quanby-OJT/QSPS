import { describe, expect, it } from "vitest"

import { BUSINESS_TIMEZONE } from "./business-time"

describe("BUSINESS_TIMEZONE", () => {
	it("is Asia/Manila", () => {
		expect(BUSINESS_TIMEZONE).toBe("Asia/Manila")
	})

	it("is a timezone the runtime recognises", () => {
		expect(() => new Intl.DateTimeFormat("en-PH", { timeZone: BUSINESS_TIMEZONE })).not.toThrow()
	})

	it("is UTC+8 with no daylight saving", () => {
		const hourIn = (iso: string) =>
			new Intl.DateTimeFormat("en-GB", {
				timeZone: BUSINESS_TIMEZONE,
				hour: "2-digit",
				hourCycle: "h23",
			}).format(new Date(iso))

		// Midnight UTC is 08:00 in Manila in both January and July.
		expect(hourIn("2026-01-15T00:00:00Z")).toBe("08")
		expect(hourIn("2026-07-15T00:00:00Z")).toBe("08")
	})
})
