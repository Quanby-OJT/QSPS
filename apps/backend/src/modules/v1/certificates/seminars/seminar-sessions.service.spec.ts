import { ORPCError } from "@orpc/server"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { inScope } from "@/common/scope/scope-match"

import type { BookingService } from "../../bookings/bookings.service"
import { missingRequiredSteps } from "../../processing/steps/item-steps"
import type { DocumentService } from "../documents.service"
import { SeminarSessionService } from "./seminar-sessions.service"

// BookingService reads PolicyService, which loads @repo/contracts (and the
// ESM-only @orpc/contract). This spec does not test policies.
jest.mock("@/common/policy/policy.service", () => ({
	PolicyService: jest.fn(),
}))
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options: { message: string }
		) {
			super(options.message)
		}
	},
}))
jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn(), transaction: jest.fn() },
}))
jest.mock("@/config/env.config", () => ({
	env: { APP_WEB_URL: "http://localhost:3001" },
}))
jest.mock("@/modules/v1/forms/form-answers-display", () => ({
	readableAnswers: jest.fn(),
}))
// Scope matching has its own spec; here it only answers yes or no.
jest.mock("@/common/scope/scope-match", () => ({
	NATIONWIDE_SCOPE: { nationwide: true },
	inScope: jest.fn(),
	scopeCondition: jest.fn(() => undefined),
}))
jest.mock("../../processing/steps/item-steps", () => ({
	missingRequiredSteps: jest.fn(),
}))

/** 13:00 on Wednesday 25 November 2026 in Manila. */
const NOW = new Date("2026-11-25T05:00:00.000Z")

const sessionRow = {
	scheduleSlotId: 7,
	serviceId: 3,
	serviceName: "Basic Hygiene and Sanitation Seminar",
	serviceCategoryId: 5,
	documentType: "food-safety-training",
	locationId: 2,
	locationName: "BOQ Manila",
	startsAt: new Date("2026-11-25T06:00:00.000Z"),
	endsAt: new Date("2026-11-25T09:00:00.000Z"),
	capacity: 30,
	bookedCount: 5,
}

function attendee(
	id: number,
	status: string,
	bookingStatus = "paid",
	documentNumber: string | null = null
) {
	return {
		scheduleSlotId: 7,
		bookingItemId: id,
		bookingId: id + 100,
		referenceNumber: `QSPS-261118-AAAA0${id}`,
		clientName: `Client ${id}`,
		status,
		bookingStatus,
		documentNumber,
	}
}

/** A query that resolves to `rows` however it is finished. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	for (const step of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "for"]) {
		chain[step] = () => chain
	}
	chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
		Promise.resolve(rows).then(resolve, reject)
	return chain
}

/** The next selects on `db` answer with these row sets, in order. */
function dbSelects(...rowSets: unknown[][]) {
	for (const rows of rowSets) jest.mocked(db.select).mockReturnValueOnce(query(rows) as never)
}

/** Each transaction the service opens gets its own selects, in order. */
function transactions(...selectsPerTransaction: unknown[][][]) {
	for (const rowSets of selectsPerTransaction) {
		const queue = [...rowSets]
		const tx = { select: jest.fn(() => query(queue.shift() ?? [])) }
		jest
			.mocked(db.transaction)
			.mockImplementationOnce((async (run: (t: unknown) => unknown) => run(tx)) as never)
	}
}

describe("SeminarSessionService (CRT-6)", () => {
	let audit: { record: jest.Mock }
	let bookingService: { transitionItem: jest.Mock; completeIfAllItemsFinal: jest.Mock }
	let documentService: { issue: jest.Mock }
	let service: SeminarSessionService

	beforeEach(() => {
		jest.clearAllMocks()
		jest.mocked(db.select).mockReset()
		jest.mocked(db.transaction).mockReset()
		jest.mocked(inScope).mockReset().mockReturnValue(true)
		jest.mocked(missingRequiredSteps).mockReset().mockResolvedValue([])
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = {
			transitionItem: jest.fn(async (_tx: unknown, _id: number, to: string) => ({ from: "x", to })),
			completeIfAllItemsFinal: jest.fn().mockResolvedValue(true),
		}
		documentService = { issue: jest.fn() }
		service = new SeminarSessionService(
			audit as unknown as AuditService,
			bookingService as unknown as BookingService,
			documentService as unknown as DocumentService
		)
	})

	describe("sessions", () => {
		it("lists the day's sessions with how many attendees are paid, present, absent and certified", async () => {
			dbSelects(
				[sessionRow],
				[
					attendee(1, "booked"),
					attendee(2, "cleared"),
					attendee(3, "issued", "completed", "FST-MNL-2026-000001"),
					attendee(4, "no_show"),
					attendee(5, "booked", "pending_payment"),
				]
			)

			const result = await service.sessions({}, "staff-1", undefined, NOW)

			expect(result.date).toBe("2026-11-25")
			expect(result.sessions).toEqual([
				{
					scheduleSlotId: 7,
					serviceId: 3,
					serviceName: "Basic Hygiene and Sanitation Seminar",
					locationId: 2,
					locationName: "BOQ Manila",
					startsAt: sessionRow.startsAt,
					endsAt: sessionRow.endsAt,
					capacity: 30,
					bookedCount: 5,
					paidCount: 4,
					presentCount: 2,
					absentCount: 1,
					issuedCount: 1,
				},
			])
		})

		it("answers an empty list without looking for attendees when the day has no session", async () => {
			dbSelects([])
			const result = await service.sessions({ date: "2026-12-01" }, "staff-1")
			expect(result).toEqual({ date: "2026-12-01", sessions: [] })
			expect(db.select).toHaveBeenCalledTimes(1)
		})

		it("needs a signed-in user", async () => {
			await expect(service.sessions({}, null)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		})
	})

	describe("roster", () => {
		it("lists the clients booked into the session, with payment and certificate", async () => {
			dbSelects(
				[sessionRow],
				[
					attendee(1, "booked", "pending_payment"),
					attendee(2, "issued", "paid", "FST-MNL-2026-000001"),
				]
			)

			const result = await service.roster({ scheduleSlotId: 7 }, "staff-1")

			expect(result.session).toMatchObject({ scheduleSlotId: 7, bookedCount: 5, issuedCount: 1 })
			expect(result.attendees).toEqual([
				{
					bookingItemId: 1,
					referenceNumber: "QSPS-261118-AAAA01",
					clientName: "Client 1",
					status: "booked",
					paymentStatus: "unpaid",
					documentNumber: null,
				},
				{
					bookingItemId: 2,
					referenceNumber: "QSPS-261118-AAAA02",
					clientName: "Client 2",
					status: "issued",
					paymentStatus: "paid",
					documentNumber: "FST-MNL-2026-000001",
				},
			])
			expect(inScope).toHaveBeenCalledWith(expect.anything(), {
				serviceCategoryId: 5,
				locationId: 2,
			})
		})

		it("answers 404 when the slot does not exist, without an audit entry", async () => {
			dbSelects([])
			await expect(service.roster({ scheduleSlotId: 99 }, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("answers 404 for a slot of a Service that is not a seminar", async () => {
			dbSelects([{ ...sessionRow, documentType: "icv-record" }])
			await expect(service.roster({ scheduleSlotId: 7 }, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
		})

		it("answers 404 outside the caller's Scope and audits the denial", async () => {
			jest.mocked(inScope).mockReturnValue(false)
			dbSelects([sessionRow])

			await expect(service.roster({ scheduleSlotId: 7 }, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})

			expect(audit.record).toHaveBeenCalledWith({
				domain: "certificates",
				action: "seminar_session.read",
				outcome: "denied",
				actorId: "staff-1",
				targetType: "schedule_slot",
				targetId: "7",
				reason: "outside_scope",
			})
			expect(db.select).toHaveBeenCalledTimes(1)
		})
	})

	describe("markAttendance", () => {
		it("checks in, assesses and clears a paid attendee through BookingService", async () => {
			dbSelects([sessionRow], [attendee(1, "booked")])
			transactions([[{ id: 101, status: "paid" }], [{ id: 1, status: "booked" }]])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [1], absent: [] },
				"staff-1",
				undefined,
				NOW
			)

			expect(result.results).toEqual([
				{ bookingItemId: 1, outcome: "present", message: "Marked present" },
			])
			expect(
				bookingService.transitionItem.mock.calls.map(call => [call[1], call[2], call[3]])
			).toEqual([
				[1, "checked_in", { actorId: "staff-1", allowedFrom: ["booked"], now: NOW }],
				[
					1,
					"in_assessment",
					{ actorId: "staff-1", allowedFrom: ["checked_in", "returned"], now: NOW },
				],
				[1, "cleared", { actorId: "staff-1", allowedFrom: ["in_assessment"], now: NOW }],
			])
		})

		it("carries on from the point an attendee already reached at the counter", async () => {
			dbSelects([sessionRow], [attendee(1, "checked_in")])
			transactions([[{ id: 101, status: "paid" }], [{ id: 1, status: "checked_in" }]])

			await service.markAttendance({ scheduleSlotId: 7, present: [1], absent: [] }, "staff-1")

			expect(bookingService.transitionItem.mock.calls.map(call => call[2])).toEqual([
				"in_assessment",
				"cleared",
			])
		})

		it("marks an absentee no_show and completes the Booking when nothing else is open", async () => {
			dbSelects([sessionRow], [attendee(2, "booked")])
			transactions([[{ id: 102, status: "paid" }], [{ id: 2, status: "booked" }]])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [], absent: [2] },
				"staff-1",
				undefined,
				NOW
			)

			expect(result.results).toEqual([
				{ bookingItemId: 2, outcome: "absent", message: "Marked absent" },
			])
			expect(bookingService.transitionItem).toHaveBeenCalledWith(expect.anything(), 2, "no_show", {
				actorId: "staff-1",
				allowedFrom: ["booked"],
				now: NOW,
			})
			expect(bookingService.completeIfAllItemsFinal).toHaveBeenCalledWith(
				expect.anything(),
				102,
				"staff-1",
				NOW
			)
		})

		it("refuses an unpaid Booking, changing nothing (Annex B)", async () => {
			dbSelects([sessionRow], [attendee(1, "booked", "pending_payment")])
			transactions([[{ id: 101, status: "pending_payment" }], [{ id: 1, status: "booked" }]])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [1], absent: [] },
				"staff-1"
			)

			expect(result.results).toEqual([
				{
					bookingItemId: 1,
					outcome: "refused",
					message: "Payment required: the booking is not paid yet, so attendance cannot be marked.",
				},
			])
			expect(bookingService.transitionItem).not.toHaveBeenCalled()
		})

		it("changes nothing when an attendee is already marked, so marking twice is harmless", async () => {
			dbSelects(
				[sessionRow],
				[attendee(1, "cleared"), attendee(2, "no_show"), attendee(3, "issued")]
			)
			// Present attendees are handled first, then absent ones: 1, 3, 2.
			transactions(
				[[{ id: 101, status: "paid" }], [{ id: 1, status: "cleared" }]],
				[[{ id: 103, status: "completed" }], [{ id: 3, status: "issued" }]],
				[[{ id: 102, status: "paid" }], [{ id: 2, status: "no_show" }]]
			)

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [1, 3], absent: [2] },
				"staff-1"
			)

			expect(result.results.map(r => [r.bookingItemId, r.outcome])).toEqual([
				[1, "unchanged"],
				[3, "unchanged"],
				[2, "unchanged"],
			])
			expect(bookingService.transitionItem).not.toHaveBeenCalled()
		})

		it("refuses to mark an attendee absent who is already checked in", async () => {
			dbSelects([sessionRow], [attendee(1, "checked_in")])
			transactions([[{ id: 101, status: "paid" }], [{ id: 1, status: "checked_in" }]])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [], absent: [1] },
				"staff-1"
			)

			expect(result.results[0]).toMatchObject({ outcome: "refused" })
			expect(result.results[0]?.message).toContain("cannot be marked absent")
			expect(bookingService.transitionItem).not.toHaveBeenCalled()
		})

		it("refuses to mark a no-show or rejected attendee present", async () => {
			dbSelects([sessionRow], [attendee(1, "no_show")])
			transactions([[{ id: 101, status: "paid" }], [{ id: 1, status: "no_show" }]])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [1], absent: [] },
				"staff-1"
			)

			expect(result.results[0]).toMatchObject({ outcome: "refused" })
			expect(result.results[0]?.message).toContain("no show")
		})

		it("names the required steps still open, and never clears the attendee (PRC-4)", async () => {
			jest.mocked(missingRequiredSteps).mockResolvedValue(["Temperature check"])
			dbSelects([sessionRow], [attendee(1, "booked")])
			transactions([[{ id: 101, status: "paid" }], [{ id: 1, status: "booked" }]])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [1], absent: [] },
				"staff-1"
			)

			expect(result.results[0]).toMatchObject({ outcome: "refused" })
			expect(result.results[0]?.message).toContain("Temperature check")
			expect(bookingService.transitionItem.mock.calls.map(call => call[2])).not.toContain("cleared")
		})

		it("says so when the Service needs head approval, so the certificate must wait", async () => {
			bookingService.transitionItem.mockImplementation(async (_tx, _id, to: string) => ({
				from: "in_assessment",
				to: to === "cleared" ? "pending_head_approval" : to,
			}))
			dbSelects([sessionRow], [attendee(1, "booked")])
			transactions([[{ id: 101, status: "paid" }], [{ id: 1, status: "booked" }]])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [1], absent: [] },
				"staff-1"
			)

			expect(result.results[0]).toMatchObject({ outcome: "present" })
			expect(result.results[0]?.message).toContain("head must approve")
		})

		it("reports an attendee that is not in the session without touching it", async () => {
			dbSelects([sessionRow], [attendee(1, "booked")])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [99], absent: [] },
				"staff-1"
			)

			expect(result.results).toEqual([
				{
					bookingItemId: 99,
					outcome: "not_found",
					message: "This attendee is not in this session",
				},
			])
			expect(db.transaction).not.toHaveBeenCalled()
		})

		it("handles each attendee on its own: one refusal does not block the others", async () => {
			dbSelects([sessionRow], [attendee(1, "booked", "pending_payment"), attendee(2, "booked")])
			transactions(
				[[{ id: 101, status: "pending_payment" }], [{ id: 1, status: "booked" }]],
				[[{ id: 102, status: "paid" }], [{ id: 2, status: "booked" }]]
			)

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [1, 2], absent: [] },
				"staff-1"
			)

			expect(result.results.map(r => [r.bookingItemId, r.outcome])).toEqual([
				[1, "refused"],
				[2, "present"],
			])
		})

		it("marks an attendee only once when the request names it twice", async () => {
			dbSelects([sessionRow], [attendee(1, "booked")])
			transactions([[{ id: 101, status: "paid" }], [{ id: 1, status: "booked" }]])

			const result = await service.markAttendance(
				{ scheduleSlotId: 7, present: [1, 1], absent: [] },
				"staff-1"
			)

			expect(result.results).toHaveLength(1)
			expect(db.transaction).toHaveBeenCalledTimes(1)
		})

		it("fails the whole request on an error that is not about one attendee", async () => {
			dbSelects([sessionRow], [attendee(1, "booked")])
			jest.mocked(db.transaction).mockRejectedValueOnce(new Error("connection lost") as never)

			await expect(
				service.markAttendance({ scheduleSlotId: 7, present: [1], absent: [] }, "staff-1")
			).rejects.toThrow("connection lost")
		})

		it("answers 404 outside the caller's Scope, audits it and marks nobody", async () => {
			jest.mocked(inScope).mockReturnValue(false)
			dbSelects([sessionRow])

			await expect(
				service.markAttendance({ scheduleSlotId: 7, present: [1], absent: [] }, "staff-1")
			).rejects.toMatchObject({ code: "NOT_FOUND" })

			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "seminar_session.attendance",
					outcome: "denied",
					targetId: "7",
					reason: "outside_scope",
				})
			)
			expect(db.transaction).not.toHaveBeenCalled()
		})
	})

	describe("issue", () => {
		const issued = (number: string, created: boolean) => ({
			created,
			document: { documentNumber: number },
		})

		beforeEach(() => {
			// DocumentService.issue runs in its own transaction per attendee.
			jest
				.mocked(db.transaction)
				.mockImplementation((async (run: (t: unknown) => unknown) => run({})) as never)
		})

		it("issues to every attendee marked present, one DocumentService.issue call each", async () => {
			dbSelects(
				[sessionRow],
				[
					attendee(1, "cleared"),
					attendee(2, "booked"),
					attendee(3, "issued", "completed", "FST-MNL-2026-000001"),
					attendee(4, "no_show"),
				]
			)
			documentService.issue
				.mockResolvedValueOnce(issued("FST-MNL-2026-000002", true))
				.mockResolvedValueOnce(issued("FST-MNL-2026-000001", false))

			const result = await service.issue({ scheduleSlotId: 7 }, "staff-1", undefined, NOW)

			expect(result.results).toEqual([
				{
					bookingItemId: 1,
					outcome: "issued",
					message: "Certificate FST-MNL-2026-000002 issued",
					documentNumber: "FST-MNL-2026-000002",
				},
				{
					bookingItemId: 3,
					outcome: "already_issued",
					message: "Already holds certificate FST-MNL-2026-000001",
					documentNumber: "FST-MNL-2026-000001",
				},
			])
			expect(documentService.issue).toHaveBeenCalledTimes(2)
			expect(documentService.issue).toHaveBeenNthCalledWith(1, expect.anything(), {
				bookingItemId: 1,
				actorId: "staff-1",
				now: NOW,
			})
			expect(db.transaction).toHaveBeenCalledTimes(2)
		})

		it("reports a refusal for that attendee only and still issues the rest", async () => {
			dbSelects([sessionRow], [attendee(1, "cleared"), attendee(2, "cleared")])
			documentService.issue
				.mockRejectedValueOnce(
					new ORPCError("CONFLICT", { message: "Booking item is not ready to issue" })
				)
				.mockResolvedValueOnce(issued("FST-MNL-2026-000003", true))

			const result = await service.issue({ scheduleSlotId: 7 }, "staff-1")

			expect(result.results.map(r => [r.bookingItemId, r.outcome])).toEqual([
				[1, "refused"],
				[2, "issued"],
			])
			expect(result.results[0]).toMatchObject({
				message: "Booking item is not ready to issue",
				documentNumber: null,
			})
		})

		it("issues only the attendees chosen, and refuses one who is not marked present", async () => {
			dbSelects([sessionRow], [attendee(1, "cleared"), attendee(2, "booked")])
			documentService.issue.mockResolvedValueOnce(issued("FST-MNL-2026-000004", true))

			const result = await service.issue(
				{ scheduleSlotId: 7, bookingItemIds: [1, 2, 99, 1] },
				"staff-1"
			)

			expect(result.results.map(r => [r.bookingItemId, r.outcome])).toEqual([
				[1, "issued"],
				[2, "refused"],
				[99, "not_found"],
			])
			expect(result.results[1]?.message).toBe(
				"Mark this attendee present before issuing a certificate"
			)
			expect(documentService.issue).toHaveBeenCalledTimes(1)
		})

		it("answers an empty list when nobody is marked present", async () => {
			dbSelects([sessionRow], [attendee(1, "booked"), attendee(2, "no_show")])
			await expect(service.issue({ scheduleSlotId: 7 }, "staff-1")).resolves.toEqual({
				results: [],
			})
			expect(documentService.issue).not.toHaveBeenCalled()
		})

		it("fails the whole request on an error that is not about one attendee", async () => {
			dbSelects([sessionRow], [attendee(1, "cleared")])
			documentService.issue.mockRejectedValueOnce(new Error("connection lost"))
			await expect(service.issue({ scheduleSlotId: 7 }, "staff-1")).rejects.toThrow(
				"connection lost"
			)
		})

		it("answers 404 outside the caller's Scope, audits it and issues nothing", async () => {
			jest.mocked(inScope).mockReturnValue(false)
			dbSelects([sessionRow])

			await expect(service.issue({ scheduleSlotId: 7 }, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})

			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "seminar_session.issue",
					outcome: "denied",
					reason: "outside_scope",
				})
			)
			expect(documentService.issue).not.toHaveBeenCalled()
		})
	})
})
