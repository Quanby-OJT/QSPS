import { announcementState, parseByteRange, sniffAnnouncementMedia } from "./announcement-rules"

jest.mock("@repo/contracts", () => ({ ANNOUNCEMENT_MEDIA_TYPES: {} }))

const now = new Date("2026-11-26T08:00:00Z")
const hour = 60 * 60 * 1000

describe("announcementState", () => {
	const base = { isActive: true, startsAt: new Date(now.getTime() - hour), endsAt: null }

	it("is inactive when switched off, whatever the dates", () => {
		expect(announcementState({ ...base, isActive: false }, now)).toBe("inactive")
	})
	it("is scheduled before its start", () => {
		expect(announcementState({ ...base, startsAt: new Date(now.getTime() + hour) }, now)).toBe(
			"scheduled"
		)
	})
	it("is showing inside its range, and with no end", () => {
		expect(announcementState(base, now)).toBe("showing")
		expect(announcementState({ ...base, endsAt: new Date(now.getTime() + hour) }, now)).toBe(
			"showing"
		)
	})
	it("has ended from its end time on", () => {
		expect(announcementState({ ...base, endsAt: now }, now)).toBe("ended")
	})
})

describe("sniffAnnouncementMedia", () => {
	it("knows PNG, JPG and MP4", () => {
		expect(
			sniffAnnouncementMedia(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		).toBe("image/png")
		expect(sniffAnnouncementMedia(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
		expect(
			sniffAnnouncementMedia(
				new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
			)
		).toBe("video/mp4")
	})
	it("refuses a PDF and unknown bytes", () => {
		expect(sniffAnnouncementMedia(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull()
		expect(
			sniffAnnouncementMedia(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
		).toBeNull()
	})
})

describe("parseByteRange", () => {
	it("sends the whole file without a usable header", () => {
		expect(parseByteRange(undefined, 100)).toBeNull()
		expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull()
	})
	it("reads open, closed and suffix ranges", () => {
		expect(parseByteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 })
		expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 })
		expect(parseByteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 })
		expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 })
	})
	it("refuses ranges outside the file", () => {
		expect(parseByteRange("bytes=100-", 100)).toBe("invalid")
		expect(parseByteRange("bytes=20-10", 100)).toBe("invalid")
		expect(parseByteRange("bytes=-0", 100)).toBe("invalid")
	})
})
