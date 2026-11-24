import { describe, expect, it } from "vitest"

import type { SeminarAttendee } from "@repo/contracts"

import {
	attendeeStatusLabel,
	canIssue,
	canMarkAbsent,
	canMarkPresent,
	isMarkedPresent,
	selectedFor,
	sessionSummary,
} from "./seminars"

function attendee(
	bookingItemId: number,
	status: SeminarAttendee["status"],
	paymentStatus: SeminarAttendee["paymentStatus"] = "paid"
): SeminarAttendee {
	return {
		bookingItemId,
		referenceNumber: `QSPS-261118-AAAA0${bookingItemId}`,
		clientName: `Client ${bookingItemId}`,
		status,
		paymentStatus,
		documentNumber: null,
	}
}

describe("seminar roster actions (CRT-6)", () => {
	it("marks a paid attendee present until they are cleared", () => {
		expect(canMarkPresent(attendee(1, "booked"))).toBe(true)
		expect(canMarkPresent(attendee(1, "checked_in"))).toBe(true)
		expect(canMarkPresent(attendee(1, "in_assessment"))).toBe(true)
		expect(canMarkPresent(attendee(1, "cleared"))).toBe(false)
		expect(canMarkPresent(attendee(1, "no_show"))).toBe(false)
	})

	it("marks absent only a paid attendee who has not arrived", () => {
		expect(canMarkAbsent(attendee(1, "booked"))).toBe(true)
		expect(canMarkAbsent(attendee(1, "checked_in"))).toBe(false)
		expect(canMarkAbsent(attendee(1, "no_show"))).toBe(false)
	})

	it("never marks an unpaid attendee", () => {
		expect(canMarkPresent(attendee(1, "booked", "unpaid"))).toBe(false)
		expect(canMarkAbsent(attendee(1, "booked", "unpaid"))).toBe(false)
	})

	it("issues only to cleared attendees", () => {
		expect(canIssue(attendee(1, "cleared"))).toBe(true)
		expect(canIssue(attendee(1, "issued"))).toBe(false)
		expect(canIssue(attendee(1, "booked"))).toBe(false)
	})

	it("counts checked in, cleared and issued attendees as present", () => {
		expect(isMarkedPresent(attendee(1, "checked_in"))).toBe(true)
		expect(isMarkedPresent(attendee(1, "issued"))).toBe(true)
		expect(isMarkedPresent(attendee(1, "no_show"))).toBe(false)
		expect(isMarkedPresent(attendee(1, "booked"))).toBe(false)
	})

	it("keeps only the ticked attendees an action allows, in roster order", () => {
		const roster = [
			attendee(1, "booked"),
			attendee(2, "no_show"),
			attendee(3, "booked", "unpaid"),
			attendee(4, "booked"),
		]
		expect(selectedFor(roster, new Set([4, 3, 2, 1]), canMarkPresent)).toEqual([1, 4])
		expect(selectedFor(roster, new Set(), canMarkPresent)).toEqual([])
		expect(selectedFor(roster, new Set([99]), canMarkPresent)).toEqual([])
	})
})

describe("seminar roster wording (CRT-6)", () => {
	it("says what each attendee's state means", () => {
		expect(attendeeStatusLabel(attendee(1, "booked", "unpaid"))).toBe("Awaiting payment")
		expect(attendeeStatusLabel(attendee(1, "booked"))).toBe("Not marked yet")
		expect(attendeeStatusLabel(attendee(1, "no_show"))).toBe("Absent")
		expect(attendeeStatusLabel(attendee(1, "cleared"))).toBe("Present")
		expect(attendeeStatusLabel(attendee(1, "issued"))).toBe("Certificate issued")
		expect(attendeeStatusLabel(attendee(1, "pending_head_approval"))).toBe(
			"Present, awaiting head approval"
		)
	})

	it("summarises a session in one line", () => {
		expect(
			sessionSummary({
				bookedCount: 5,
				capacity: 30,
				paidCount: 4,
				presentCount: 2,
				absentCount: 1,
				issuedCount: 1,
			})
		).toBe("5 of 30 seats booked · 4 paid · 2 present · 1 absent · 1 certified")
	})
})
