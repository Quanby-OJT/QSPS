import { describe, expect, it } from "vitest"

import { HaccpDetailsSchema, IssueDocumentSchema } from "./certificates.schema.js"
import {
	MAX_SEMINAR_ATTENDEES_PER_REQUEST,
	SeminarAttendanceSchema,
	SeminarIssueSchema,
	SeminarSessionParamSchema,
	SeminarSessionsRequestSchema,
} from "./seminar.schema.js"

describe("HACCP details (CRT-6)", () => {
	it("accepts a validity period", () => {
		const parsed = HaccpDetailsSchema.parse({ validFrom: "2026-12-01", validUntil: "2027-11-30" })
		expect(parsed).toEqual({ validFrom: "2026-12-01", validUntil: "2027-11-30" })
	})

	it("accepts a one-day validity", () => {
		expect(
			HaccpDetailsSchema.safeParse({ validFrom: "2026-12-01", validUntil: "2026-12-01" }).success
		).toBe(true)
	})

	it("refuses an end date before the start date, naming validUntil", () => {
		const result = HaccpDetailsSchema.safeParse({
			validFrom: "2026-12-01",
			validUntil: "2026-11-30",
		})
		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.path).toEqual(["validUntil"])
	})

	it("refuses a missing date or a date that is not a calendar date", () => {
		expect(HaccpDetailsSchema.safeParse({ validFrom: "2026-12-01" }).success).toBe(false)
		expect(
			HaccpDetailsSchema.safeParse({ validFrom: "2026-12-01", validUntil: "next year" }).success
		).toBe(false)
	})
})

describe("issuing a HACCP Certificate (CRT-6)", () => {
	const haccp = { validFrom: "2026-12-01", validUntil: "2027-11-30" }

	it("takes the HACCP details and leaves the other kinds null", () => {
		const parsed = IssueDocumentSchema.parse({ bookingItemId: 44, haccp })
		expect(parsed.haccp).toEqual(haccp)
		expect(parsed.details).toBeNull()
		expect(parsed.exemption).toBeNull()
		expect(parsed.sanitaryPermit).toBeNull()
		expect(parsed.shipSanitation).toBeNull()
	})

	it("refuses HACCP details together with another kind of details", () => {
		expect(
			IssueDocumentSchema.safeParse({ bookingItemId: 44, haccp, sanitaryPermit: haccp }).success
		).toBe(false)
	})
})

describe("seminar sessions (CRT-6)", () => {
	it("lists today's sessions when no date is given, or one Manila date", () => {
		expect(SeminarSessionsRequestSchema.parse({})).toEqual({})
		expect(SeminarSessionsRequestSchema.parse({ date: "2026-11-25" })).toEqual({
			date: "2026-11-25",
		})
		expect(SeminarSessionsRequestSchema.safeParse({ date: "25/11/2026" }).success).toBe(false)
	})

	it("reads the slot id from the URL as a number and refuses anything else", () => {
		expect(SeminarSessionParamSchema.parse({ scheduleSlotId: "7" })).toEqual({ scheduleSlotId: 7 })
		expect(SeminarSessionParamSchema.safeParse({ scheduleSlotId: "abc" }).success).toBe(false)
		expect(SeminarSessionParamSchema.safeParse({ scheduleSlotId: 0 }).success).toBe(false)
	})
})

describe("marking seminar attendance (CRT-6)", () => {
	it("accepts present and absent attendees, either list alone", () => {
		expect(
			SeminarAttendanceSchema.parse({ scheduleSlotId: 7, present: [1, 2], absent: [3] })
		).toEqual({ scheduleSlotId: 7, present: [1, 2], absent: [3] })
		expect(SeminarAttendanceSchema.parse({ scheduleSlotId: 7, absent: [3] }).present).toEqual([])
		expect(SeminarAttendanceSchema.parse({ scheduleSlotId: 7, present: [1] }).absent).toEqual([])
	})

	it("needs at least one attendee", () => {
		const result = SeminarAttendanceSchema.safeParse({ scheduleSlotId: 7 })
		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.message).toBe("Choose at least one attendee to mark")
	})

	it("refuses an attendee marked both present and absent", () => {
		const result = SeminarAttendanceSchema.safeParse({
			scheduleSlotId: 7,
			present: [1, 2],
			absent: [2],
		})
		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.path).toEqual(["absent"])
	})

	it("refuses more attendees than one request may carry", () => {
		const tooMany = Array.from({ length: MAX_SEMINAR_ATTENDEES_PER_REQUEST + 1 }, (_, i) => i + 1)
		expect(SeminarAttendanceSchema.safeParse({ scheduleSlotId: 7, present: tooMany }).success).toBe(
			false
		)
	})
})

describe("issuing seminar certificates (CRT-6)", () => {
	it("issues to everyone marked present when no attendees are named", () => {
		expect(SeminarIssueSchema.parse({ scheduleSlotId: 7 })).toEqual({ scheduleSlotId: 7 })
	})

	it("issues to the named attendees only, and refuses an empty choice", () => {
		expect(SeminarIssueSchema.parse({ scheduleSlotId: 7, bookingItemIds: [1, 2] })).toEqual({
			scheduleSlotId: 7,
			bookingItemIds: [1, 2],
		})
		expect(SeminarIssueSchema.safeParse({ scheduleSlotId: 7, bookingItemIds: [] }).success).toBe(
			false
		)
	})
})
