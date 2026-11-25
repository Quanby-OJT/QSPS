import { oc } from "@orpc/contract"
import { z } from "zod"

import {
	DocumentSummarySchema,
	DocumentTokenParamSchema,
	DocumentVerificationSchema,
	IssueDocumentSchema,
	ManualVerificationSchema,
	MyDocumentsSchema,
	ReissueDocumentSchema,
	RevokeDocumentSchema,
} from "./certificates.schema.js"
import {
	SeminarAttendanceResultSchema,
	SeminarAttendanceSchema,
	SeminarIssueResultSchema,
	SeminarIssueSchema,
	SeminarRosterSchema,
	SeminarSessionParamSchema,
	SeminarSessionsRequestSchema,
	SeminarSessionsSchema,
} from "./seminar.schema.js"

/**
 * Documents (CRT-1, Flow D). The PDF itself is a plain route,
 * GET /api/v1/certificates/documents/{documentId}/pdf, because it answers
 * with PDF bytes; so is staff printing (CRT-3), POST
 * /api/v1/certificates/documents/{documentId}/print. The two verify routes are public (CRT-2).
 */
export const certificatesContract = {
	issue: oc
		.route({
			method: "POST",
			path: "/certificates/items/{bookingItemId}/documents",
			summary: "Issue the document for a cleared Booking Item",
			description:
				"For Services with auto-issue off, or after head approval. Send `details` for the Service's vaccination record, `exemption` to issue a Medical Exemption Certificate instead (CRT-3), `sanitaryPermit` or `shipSanitation` for a sanitation Service (CRT-5), or `haccp` for a HACCP audit (CRT-6). Creates one Document with the next number for its type and Location, moves the item to issued and completes the Booking when every item is final. Issuing twice returns the same Document. A Food Safety Training Certificate is issued from the seminar roster instead. Needs certificates.documents:issue; an item at another Location answers 404.",
			tags: ["Certificates"],
		})
		.input(IssueDocumentSchema)
		.output(DocumentSummarySchema),
	mine: oc
		.route({
			method: "GET",
			path: "/certificates/mine",
			summary: "My Documents",
			description: "The signed-in client's documents, newest first. Needs certificates.own:read.",
			tags: ["Certificates"],
		})
		.input(z.object({}).optional())
		.output(MyDocumentsSchema),
	verify: oc
		.route({
			method: "GET",
			path: "/certificates/verify/{token}",
			summary: "Verify a document by its QR code",
			description:
				"Public, no session. Looks up the Document behind a scanned QR code and returns its type, number, masked holder name, issuing Location, issue date and status from the database. An unknown or malformed token answers 404 and nothing else. Rate limited.",
			tags: ["Certificates"],
		})
		.input(DocumentTokenParamSchema)
		.output(DocumentVerificationSchema),
	verifyByNumber: oc
		.route({
			method: "GET",
			path: "/certificates/verify",
			summary: "Verify a document by its number and code",
			description:
				"Public, no session. The same lookup for someone without a scanner: the Document Number plus the code printed under the QR code. A wrong pair answers 404 and nothing else. Rate limited.",
			tags: ["Certificates"],
		})
		.input(ManualVerificationSchema)
		.output(DocumentVerificationSchema),
	revoke: oc
		.route({
			method: "POST",
			path: "/certificates/documents/{documentId}/revoke",
			summary: "Revoke a document",
			description:
				"CRT-8. Withdraws a valid document with a required reason; public verification shows it as revoked at once. The document is never deleted. Audited, and the client is notified. Needs certificates.documents:revoke; a document outside the caller's Scope answers 404.",
			tags: ["Certificates"],
		})
		.input(RevokeDocumentSchema)
		.output(DocumentSummarySchema),
	reissue: oc
		.route({
			method: "POST",
			path: "/certificates/documents/{documentId}/reissue",
			summary: "Reissue a corrected document",
			description:
				"CRT-8. Replaces a valid document: the old one becomes superseded and points to a new document with the next number in the same series and a new QR token. Send `details` for a vaccination record or `exemption` for a Medical Exemption Certificate, and a reason. Audited, and the client is notified. Needs certificates.documents:revoke; a document outside the caller's Scope answers 404. Returns the new document.",
			tags: ["Certificates"],
		})
		.input(ReissueDocumentSchema)
		.output(DocumentSummarySchema),
	seminarSessions: oc
		.route({
			method: "GET",
			path: "/certificates/seminar-sessions",
			summary: "Seminar sessions of a date",
			description:
				"CRT-6. The Schedule Slots of Services that issue the Food Safety Training Certificate, for one Manila date (today by default), inside the caller's Scope, with capacity and how many attendees are paid, present, absent and certified. Needs certificates.documents:issue.",
			tags: ["Certificates"],
		})
		.input(SeminarSessionsRequestSchema)
		.output(SeminarSessionsSchema),
	seminarRoster: oc
		.route({
			method: "GET",
			path: "/certificates/seminar-sessions/{scheduleSlotId}/roster",
			summary: "Roster of a seminar session",
			description:
				"CRT-6. The clients booked into one seminar session, with payment status, attendance status and certificate number. A session outside the caller's Scope answers 404 and the attempt is audited. Needs certificates.documents:issue.",
			tags: ["Certificates"],
		})
		.input(SeminarSessionParamSchema)
		.output(SeminarRosterSchema),
	seminarAttendance: oc
		.route({
			method: "POST",
			path: "/certificates/seminar-sessions/{scheduleSlotId}/attendance",
			summary: "Mark seminar attendance",
			description:
				"CRT-6. Marks attendees present (checked in and cleared, through the same booking steps as processing) or absent (no_show). Only paid Bookings can be marked. Each attendee is handled on its own, and the answer lists what happened to each. Marking again changes nothing. Needs certificates.documents:issue; a session outside the caller's Scope answers 404 and the attempt is audited.",
			tags: ["Certificates"],
		})
		.input(SeminarAttendanceSchema)
		.output(SeminarAttendanceResultSchema),
	seminarIssue: oc
		.route({
			method: "POST",
			path: "/certificates/seminar-sessions/{scheduleSlotId}/issue",
			summary: "Issue Food Safety Training Certificates",
			description:
				"CRT-6. Issues the Food Safety Training Certificate to every attendee marked present (or to the chosen attendees), one document each through the same issuing step as a single issue. Each attendee is handled on its own, so one refusal never blocks the others, and running it again creates nothing new. The answer lists issued, already issued and refused attendees with the reason. Needs certificates.documents:issue; a session outside the caller's Scope answers 404 and the attempt is audited.",
			tags: ["Certificates"],
		})
		.input(SeminarIssueSchema)
		.output(SeminarIssueResultSchema),
}
