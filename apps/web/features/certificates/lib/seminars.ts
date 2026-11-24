import type { BookingItemStatus, SeminarAttendee } from "@repo/contracts"

/** Item statuses that mean the attendee was marked present and holds, or can get, a certificate. */
const PRESENT_STATUSES: readonly BookingItemStatus[] = [
	"checked_in",
	"in_assessment",
	"cleared",
	"pending_head_approval",
	"issued",
]

/** CRT-6: a paid attendee who has not been marked yet can be marked present. */
export function canMarkPresent(attendee: SeminarAttendee): boolean {
	return (
		attendee.paymentStatus === "paid" &&
		(attendee.status === "booked" ||
			attendee.status === "checked_in" ||
			attendee.status === "in_assessment")
	)
}

/** CRT-6: only a paid attendee who has not arrived yet can be marked absent (`no_show`). */
export function canMarkAbsent(attendee: SeminarAttendee): boolean {
	return attendee.paymentStatus === "paid" && attendee.status === "booked"
}

/** CRT-6: a cleared attendee is ready for a certificate; an issued one already has it. */
export function canIssue(attendee: SeminarAttendee): boolean {
	return attendee.status === "cleared"
}

export function isMarkedPresent(attendee: SeminarAttendee): boolean {
	return PRESENT_STATUSES.includes(attendee.status)
}

/** The attendees an action applies to: the ticked ones that the action allows. */
export function selectedFor(
	attendees: readonly SeminarAttendee[],
	selected: ReadonlySet<number>,
	allowed: (attendee: SeminarAttendee) => boolean
): number[] {
	return attendees
		.filter(attendee => selected.has(attendee.bookingItemId) && allowed(attendee))
		.map(attendee => attendee.bookingItemId)
}

/** What staff see in the Status column of the roster. */
export function attendeeStatusLabel(attendee: SeminarAttendee): string {
	if (attendee.paymentStatus === "unpaid") return "Awaiting payment"
	switch (attendee.status) {
		case "booked":
			return "Not marked yet"
		case "no_show":
			return "Absent"
		case "issued":
			return "Certificate issued"
		case "cleared":
			return "Present"
		case "pending_head_approval":
			return "Present, awaiting head approval"
		case "checked_in":
		case "in_assessment":
			return "Present, not cleared yet"
		case "returned":
			return "Returned for correction"
		case "rejected":
			return "Rejected"
	}
}

/** "3 of 5 present" style summary of one session. */
export function sessionSummary(session: {
	paidCount: number
	presentCount: number
	absentCount: number
	issuedCount: number
	bookedCount: number
	capacity: number
}): string {
	return `${session.bookedCount} of ${session.capacity} seats booked · ${session.paidCount} paid · ${session.presentCount} present · ${session.absentCount} absent · ${session.issuedCount} certified`
}
