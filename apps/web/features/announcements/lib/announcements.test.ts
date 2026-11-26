import { describe, expect, it } from "vitest"

import { fromManilaInput, parseAnnouncementDraft, toManilaInput } from "./announcements"

const key = "announcements/0b3c2b9e-6a0d-4a5f-9a43-2f6f1d0c9e11.png"

describe("Manila date-time inputs", () => {
	it("shows an instant in Manila time", () => {
		expect(toManilaInput(new Date("2026-11-26T07:30:00Z"))).toBe("2026-11-26T15:30")
		expect(toManilaInput(new Date("2026-11-26T16:05:00Z"))).toBe("2026-11-27T00:05")
	})
	it("reads an input as Manila time", () => {
		expect(fromManilaInput("2026-11-26T15:30")).toBe("2026-11-26T15:30:00+08:00")
		expect(fromManilaInput("")).toBeNull()
	})
})

describe("parseAnnouncementDraft", () => {
	const draft = {
		title: "GAD week",
		mediaKey: key,
		mediaType: "image" as const,
		startsAt: "2026-11-26T15:30",
		endsAt: "",
	}

	it("needs a file", () => {
		expect(parseAnnouncementDraft({ ...draft, mediaKey: null })).toEqual({
			ok: false,
			message: "Upload an image or video",
		})
	})
	it("refuses an end before the start", () => {
		expect(parseAnnouncementDraft({ ...draft, endsAt: "2026-11-26T15:00" })).toEqual({
			ok: false,
			message: "The end must be after the start",
		})
	})
	it("accepts a draft with no end", () => {
		const parsed = parseAnnouncementDraft(draft)
		expect(parsed.ok).toBe(true)
		if (parsed.ok) {
			expect(parsed.value.endsAt).toBeNull()
			expect(parsed.value.startsAt).toBe("2026-11-26T15:30:00+08:00")
		}
	})
})
