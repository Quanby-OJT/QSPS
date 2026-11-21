import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import type { BookingService } from "../bookings/bookings.service"
import type { DocumentService } from "../certificates/documents.service"
import { ProcessingService } from "./processing.service"

// ADM-6: BookingService now reads PolicyService, which loads @repo/contracts
// (and the ESM-only @orpc/contract). This spec does not test policies.
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
	db: {
		select: jest.fn(),
		transaction: jest.fn(),
	},
}))

/** Wednesday 18 November 2026, 09:00 in Manila. */
const NOW = new Date("2026-11-18T01:00:00.000Z")

const MANILA = { id: 2, name: "BOQ Manila" }

/** A query that resolves to `rows` however it is finished. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		innerJoin: () => chain,
		leftJoin: () => chain,
		where: () => chain,
		orderBy: () => chain,
		limit: () => Promise.resolve(rows),
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

/** db.select answers these row sets in order. */
function selects(...rowSets: unknown[][]) {
	const select = jest.mocked(db.select)
	select.mockReset()
	for (const rows of rowSets) select.mockReturnValueOnce(query(rows) as never)
}

const detailRow = {
	bookingItemId: 44,
	status: "in_assessment",
	feeCentavos: 150000,
	bookingId: 31,
	referenceNumber: "QSPS-261117-AB12CD",
	bookingStatus: "paid",
	kind: "regular",
	totalCentavos: 150000,
	serviceId: 1,
	serviceName: "Yellow fever vaccination",
	requiresApproval: false,
	locationId: 2,
	locationName: "BOQ Manila",
	startsAt: new Date("2026-11-18T01:00:00.000Z"),
	endsAt: new Date("2026-11-18T05:00:00.000Z"),
	clientId: "client-1",
	clientName: "Juan Dela Cruz",
	clientEmail: "juan@example.com",
	clientMobile: "09171234567",
	clientBirthDate: "1990-01-01",
	clientGender: "Male",
	clientNationality: "Filipino",
}

describe("ProcessingService", () => {
	let processingService: ProcessingService
	let auditService: { record: jest.Mock }
	let bookingService: { checkInItems: jest.Mock; transitionItem: jest.Mock }
	let documentService: { issueOnClearance: jest.Mock }
	const tx = { insert: jest.fn() }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = { checkInItems: jest.fn(), transitionItem: jest.fn() }
		documentService = { issueOnClearance: jest.fn().mockResolvedValue(null) }
		jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
		processingService = new ProcessingService(
			bookingService as unknown as BookingService,
			auditService as unknown as AuditService,
			documentService as unknown as DocumentService
		)
	})

	describe("queue", () => {
		it("is empty, with no location, for a staff user who has no Location claim", async () => {
			selects([])

			await expect(processingService.queue({}, "staff-1", NOW)).resolves.toEqual({
				location: null,
				date: "2026-11-18",
				items: [],
			})
			expect(db.select).toHaveBeenCalledTimes(1)
		})

		it("lists today's items at the staff user's Location with their payment status", async () => {
			selects(
				[MANILA],
				[
					{
						bookingItemId: 44,
						status: "booked",
						referenceNumber: "QSPS-261117-AB12CD",
						bookingStatus: "paid",
						clientName: "Juan Dela Cruz",
						serviceName: "Yellow fever vaccination",
						startsAt: detailRow.startsAt,
						endsAt: detailRow.endsAt,
					},
					{
						bookingItemId: 45,
						status: "booked",
						referenceNumber: "QSPS-261117-ZX98WV",
						bookingStatus: "pending_payment",
						clientName: "Maria Santos",
						serviceName: "Yellow fever vaccination",
						startsAt: detailRow.startsAt,
						endsAt: detailRow.endsAt,
					},
				]
			)

			const queue = await processingService.queue({}, "staff-1", NOW)

			expect(queue.location).toEqual(MANILA)
			expect(queue.date).toBe("2026-11-18")
			expect(queue.items.map(item => [item.bookingItemId, item.paymentStatus])).toEqual([
				[44, "paid"],
				[45, "unpaid"],
			])
		})

		it("refuses a request with no signed-in user", async () => {
			await expect(processingService.queue({}, null, NOW)).rejects.toMatchObject({
				code: "UNAUTHORIZED",
			})
		})
	})

	describe("checkIn", () => {
		const input = { referenceNumber: "QSPS-261117-AB12CD" }

		it("checks a paid booking in and returns its items", async () => {
			selects([MANILA], [{ id: 31 }], [detailRow], [])
			bookingService.checkInItems.mockResolvedValue({
				ok: true,
				bookingItemIds: [44],
				checkedInIds: [44],
			})

			const result = await processingService.checkIn(input, "staff-1")

			expect(bookingService.checkInItems).toHaveBeenCalledWith(tx, 31, 2, "staff-1")
			expect(result.items).toHaveLength(1)
			expect(result.items[0]).toMatchObject({ bookingItemId: 44, paymentStatus: "paid" })
		})

		it("refuses an unpaid booking with 'Payment required' and audits the denial", async () => {
			selects([MANILA], [{ id: 31 }])
			bookingService.checkInItems.mockResolvedValue({
				ok: false,
				reason: "payment_required",
				bookingStatus: "pending_payment",
			})

			const error = (await processingService
				.checkIn(input, "staff-1")
				.catch((reason: unknown) => reason)) as { code: string; message: string }
			expect(error.code).toBe("CONFLICT")
			expect(error.message).toContain("Payment required")
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "processing",
					action: "booking_item.check_in",
					outcome: "denied",
					actorId: "staff-1",
					targetType: "booking",
					targetId: "31",
					reason: "payment_required",
				})
			)
		})

		it("answers 404 for a booking at another Location and audits the denial", async () => {
			selects([MANILA], [{ id: 31 }])
			bookingService.checkInItems.mockResolvedValue({ ok: false, reason: "no_items_here" })

			await expect(processingService.checkIn(input, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", reason: "outside_scope" })
			)
		})

		it("answers 404 for an unknown Reference Number", async () => {
			selects([MANILA], [])

			await expect(processingService.checkIn(input, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(bookingService.checkInItems).not.toHaveBeenCalled()
		})

		it("refuses a staff user with no Location claim without touching the booking", async () => {
			selects([], [{ id: 31 }])

			await expect(processingService.checkIn(input, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(db.transaction).not.toHaveBeenCalled()
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", reason: "no_location" })
			)
		})
	})

	describe("scope", () => {
		it("answers 404 for an item at another Location and audits the denial", async () => {
			selects([{ id: 44, locationId: 9 }], [MANILA])

			await expect(processingService.item({ bookingItemId: 44 }, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "booking_item.read",
					outcome: "denied",
					targetType: "booking_item",
					targetId: "44",
					reason: "outside_scope",
				})
			)
		})

		it("answers 404 without an audit entry when the item does not exist", async () => {
			selects([])

			await expect(processingService.item({ bookingItemId: 99 }, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(auditService.record).not.toHaveBeenCalled()
		})

		it("refuses to open an item at another Location before any change", async () => {
			selects([{ id: 44, locationId: 9 }], [MANILA])

			await expect(processingService.open({ bookingItemId: 44 }, "staff-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(bookingService.transitionItem).not.toHaveBeenCalled()
		})

		it("shows the client's profile and assessment history for an item in scope", async () => {
			const assessedAt = new Date("2026-11-18T02:00:00.000Z")
			selects(
				[{ id: 44, locationId: 2 }],
				[MANILA],
				[detailRow],
				[
					{
						id: 3,
						outcome: "returned",
						notes: "Birth date does not match the passport",
						corrections: {},
						staffId: "staff-1",
						staffName: "Officer Reyes",
						createdAt: assessedAt,
					},
				]
			)

			const item = await processingService.item({ bookingItemId: 44 }, "staff-1")

			expect(item.client).toEqual({
				id: "client-1",
				name: "Juan Dela Cruz",
				email: "juan@example.com",
				mobile: "09171234567",
				birthDate: "1990-01-01",
				gender: "Male",
				nationality: "Filipino",
			})
			expect(item.assessments).toHaveLength(1)
			expect(item.formAnswers).toEqual({})
		})
	})

	describe("open", () => {
		it("moves a checked_in or returned item to in_assessment through BookingService", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA], [detailRow], [])
			bookingService.transitionItem.mockResolvedValue({
				from: "checked_in",
				to: "in_assessment",
			})

			await processingService.open({ bookingItemId: 44 }, "staff-1")

			expect(bookingService.transitionItem).toHaveBeenCalledWith(tx, 44, "in_assessment", {
				actorId: "staff-1",
				allowedFrom: ["checked_in", "returned"],
			})
		})
	})

	describe("assess", () => {
		function mockInsert(id = 7) {
			const values = jest.fn()
			tx.insert.mockReturnValue({
				values: (row: unknown) => {
					values(row)
					return { returning: () => Promise.resolve([{ id }]) }
				},
			})
			return values
		}

		it("adds an Assessment, moves the item and audits both in one transaction", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA], [{ ...detailRow, status: "returned" }], [])
			bookingService.transitionItem.mockResolvedValue({ from: "in_assessment", to: "returned" })
			const values = mockInsert()

			const item = await processingService.assess(
				{
					bookingItemId: 44,
					outcome: "returned",
					notes: "Bring your passport",
					corrections: { birthDate: "1990-02-01" },
				},
				"staff-1"
			)

			expect(bookingService.transitionItem).toHaveBeenCalledWith(tx, 44, "returned", {
				actorId: "staff-1",
				allowedFrom: ["in_assessment"],
			})
			expect(values).toHaveBeenCalledWith({
				bookingItemId: 44,
				staffId: "staff-1",
				outcome: "returned",
				notes: "Bring your passport",
				corrections: { birthDate: "1990-02-01" },
				createdAt: expect.any(Date),
			})
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "processing",
					action: "assessment.create",
					targetId: "44",
					oldValue: { status: "in_assessment" },
					newValue: expect.objectContaining({ assessmentId: 7, status: "returned" }),
				}),
				tx
			)
			expect(item.status).toBe("returned")
		})

		it("stores an empty note as null", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA], [{ ...detailRow, status: "cleared" }], [])
			bookingService.transitionItem.mockResolvedValue({ from: "in_assessment", to: "cleared" })
			const values = mockInsert()

			await processingService.assess(
				{ bookingItemId: 44, outcome: "cleared", notes: "", corrections: {} },
				"staff-1"
			)

			expect(values).toHaveBeenCalledWith(expect.objectContaining({ notes: null }))
		})

		it("issues the document in the same transaction when the item is cleared (CRT-1)", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA], [{ ...detailRow, status: "issued" }], [])
			bookingService.transitionItem.mockResolvedValue({ from: "in_assessment", to: "cleared" })
			mockInsert()
			const document = {
				batchNumber: "YF-24A",
				vaccinatorName: "Dr. Reyes",
				validFrom: "2026-11-29",
				validUntil: null,
				passportOrIdNumber: null,
			}

			await processingService.assess(
				{ bookingItemId: 44, outcome: "cleared", notes: "", corrections: {}, document },
				"staff-1"
			)

			expect(documentService.issueOnClearance).toHaveBeenCalledWith(tx, {
				bookingItemId: 44,
				actorId: "staff-1",
				details: document,
			})
		})

		it("does not try to issue a document for a returned item", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA], [{ ...detailRow, status: "returned" }], [])
			bookingService.transitionItem.mockResolvedValue({ from: "in_assessment", to: "returned" })
			mockInsert()

			await processingService.assess(
				{ bookingItemId: 44, outcome: "returned", notes: "Bring your passport", corrections: {} },
				"staff-1"
			)

			expect(documentService.issueOnClearance).not.toHaveBeenCalled()
		})

		it("saves no assessment when the document cannot be issued", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA])
			bookingService.transitionItem.mockResolvedValue({ from: "in_assessment", to: "cleared" })
			documentService.issueOnClearance.mockRejectedValue(
				Object.assign(new Error("details required"), { code: "BAD_REQUEST" })
			)
			const values = mockInsert()

			await expect(
				processingService.assess(
					{ bookingItemId: 44, outcome: "cleared", notes: "", corrections: {} },
					"staff-1"
				)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(values).not.toHaveBeenCalled()
		})

		it("saves nothing when the item cannot move", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA])
			const conflict = Object.assign(new Error("cannot be moved"), { code: "CONFLICT" })
			bookingService.transitionItem.mockRejectedValue(conflict)
			const values = mockInsert()

			await expect(
				processingService.assess(
					{ bookingItemId: 44, outcome: "cleared", notes: "", corrections: {} },
					"staff-1"
				)
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(values).not.toHaveBeenCalled()
		})
	})
})
