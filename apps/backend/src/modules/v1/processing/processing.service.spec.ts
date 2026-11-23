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

/** A head or officer whose Scope is every Service Category at Manila only. */
const MANILA_SCOPE = {
	nationwide: false as const,
	entries: [{ serviceCategoryId: null, locationId: 2 }],
}

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
	documentId: null,
	documentNumber: null,
	issuedDocumentType: null,
	printCount: null,
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
	let bookingService: {
		checkInItems: jest.Mock
		transitionItem: jest.Mock
		overrideItem: jest.Mock
	}
	let documentService: { issueOnClearance: jest.Mock }
	const tx = { insert: jest.fn() }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = { checkInItems: jest.fn(), transitionItem: jest.fn(), overrideItem: jest.fn() }
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
		it("answers 404 for an item outside the caller's Scope and audits the denial", async () => {
			selects([{ id: 44, locationId: 9, serviceCategoryId: 1 }])

			await expect(
				processingService.item({ bookingItemId: 44 }, "staff-1", MANILA_SCOPE)
			).rejects.toMatchObject({
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
			// PRC-3: reading needs only Scope, so no station lookup.
			selects(
				[{ id: 44, locationId: 2, serviceCategoryId: 1 }],
				[detailRow],
				[
					{
						id: 3,
						outcome: "returned",
						kind: "assessment",
						notes: "Birth date does not match the passport",
						corrections: {},
						staffId: "staff-1",
						staffName: "Officer Reyes",
						createdAt: assessedAt,
					},
				]
			)

			const item = await processingService.item({ bookingItemId: 44 }, "staff-1", MANILA_SCOPE)

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
			expect(item.document).toBeNull()
		})

		it("shows the issued document's type and how often it was printed (CRT-3)", async () => {
			selects(
				[{ id: 44, locationId: 2, serviceCategoryId: 1 }],
				[
					{
						...detailRow,
						status: "issued",
						documentId: 9,
						documentNumber: "MEC-MNL-2026-000001",
						issuedDocumentType: "medical-exemption",
						printCount: 2,
					},
				],
				[]
			)

			const item = await processingService.item({ bookingItemId: 44 }, "staff-1", MANILA_SCOPE)

			expect(item.document).toEqual({
				id: 9,
				documentNumber: "MEC-MNL-2026-000001",
				documentType: "medical-exemption",
				printCount: 2,
			})
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
				exemption: null,
			})
		})

		it("passes a medical exemption to the clearing transaction instead (CRT-3)", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA], [{ ...detailRow, status: "issued" }], [])
			bookingService.transitionItem.mockResolvedValue({ from: "in_assessment", to: "cleared" })
			mockInsert()
			const exemption = {
				reason: "Egg allergy",
				physicianName: "Dr. Santos",
				validFrom: "2026-11-29",
				validUntil: null,
				passportOrIdNumber: null,
			}

			await processingService.assess(
				{ bookingItemId: 44, outcome: "cleared", notes: "", corrections: {}, exemption },
				"staff-1"
			)

			expect(documentService.issueOnClearance).toHaveBeenCalledWith(tx, {
				bookingItemId: 44,
				actorId: "staff-1",
				details: null,
				exemption,
			})
		})

		it("refuses an exemption on an item that goes to head approval, saving nothing (CRT-3)", async () => {
			selects([{ id: 44, locationId: 2 }], [MANILA])
			bookingService.transitionItem.mockResolvedValue({
				from: "in_assessment",
				to: "pending_head_approval",
			})
			const values = mockInsert()

			await expect(
				processingService.assess(
					{
						bookingItemId: 44,
						outcome: "cleared",
						notes: "",
						corrections: {},
						exemption: {
							reason: "Egg allergy",
							physicianName: "Dr. Santos",
							validFrom: "2026-11-29",
							validUntil: null,
							passportOrIdNumber: null,
						},
					},
					"staff-1"
				)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(documentService.issueOnClearance).not.toHaveBeenCalled()
			expect(values).not.toHaveBeenCalled()
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

	/** tx.insert(...).values(row).returning() resolves to one saved row. */
	function mockDecisionInsert(id = 9) {
		const values = jest.fn()
		tx.insert.mockReturnValue({
			values: (row: unknown) => {
				values(row)
				return { returning: () => Promise.resolve([{ id }]) }
			},
		})
		return values
	}

	const inScopeItem = [{ id: 44, locationId: 2, serviceCategoryId: 1 }]

	describe("approvals (PRC-3)", () => {
		it("lists pending items in Scope with the officer who cleared them", async () => {
			const assessedAt = new Date("2026-11-18T02:00:00.000Z")
			selects(
				[
					{
						bookingItemId: 44,
						status: "pending_head_approval",
						referenceNumber: "QSPS-261117-AB12CD",
						clientName: "Juan Dela Cruz",
						serviceName: "Yellow fever vaccination",
						locationId: 2,
						locationName: "BOQ Manila",
						startsAt: detailRow.startsAt,
					},
				],
				[
					{
						bookingItemId: 44,
						staffName: "Officer Reyes",
						createdAt: assessedAt,
						notes: null,
					},
				]
			)

			const queue = await processingService.approvals({ view: "pending" }, "head-1", MANILA_SCOPE)

			expect(queue.view).toBe("pending")
			expect(queue.items).toEqual([
				expect.objectContaining({
					bookingItemId: 44,
					status: "pending_head_approval",
					location: { id: 2, name: "BOQ Manila" },
					assessedBy: "Officer Reyes",
					assessedAt,
				}),
			])
		})

		it("skips the assessment lookup when nothing is waiting", async () => {
			selects([])

			await expect(
				processingService.approvals({ view: "rejected" }, "head-1", MANILA_SCOPE)
			).resolves.toEqual({ view: "rejected", items: [] })
			expect(db.select).toHaveBeenCalledTimes(1)
		})
	})

	describe("decide (PRC-3)", () => {
		it("approves a pending item: cleared, with an approval row and audit entries in one transaction", async () => {
			selects(inScopeItem, [{ staffId: "officer-1" }], [{ ...detailRow, status: "cleared" }], [])
			bookingService.transitionItem.mockResolvedValue({
				from: "pending_head_approval",
				to: "cleared",
			})
			const values = mockDecisionInsert(9)

			const item = await processingService.decide(
				{ bookingItemId: 44, decision: "approve", notes: "" },
				"head-1",
				MANILA_SCOPE
			)

			expect(bookingService.transitionItem).toHaveBeenCalledWith(tx, 44, "cleared", {
				actorId: "head-1",
				allowedFrom: ["pending_head_approval"],
			})
			expect(values).toHaveBeenCalledWith(
				expect.objectContaining({
					bookingItemId: 44,
					staffId: "head-1",
					outcome: "cleared",
					kind: "approval",
					notes: null,
					createdAt: expect.any(Date),
				})
			)
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "processing",
					action: "assessment.approve",
					actorId: "head-1",
					oldValue: { status: "pending_head_approval" },
					newValue: expect.objectContaining({ assessmentId: 9, status: "cleared" }),
				}),
				tx
			)
			expect(item.status).toBe("cleared")
		})

		it("sends a pending item back to in_assessment with the head's notes", async () => {
			selects(inScopeItem, [{ staffId: "officer-1" }], [detailRow], [])
			bookingService.transitionItem.mockResolvedValue({
				from: "pending_head_approval",
				to: "in_assessment",
			})
			const values = mockDecisionInsert()

			await processingService.decide(
				{ bookingItemId: 44, decision: "return", notes: "Check the batch number" },
				"head-1",
				MANILA_SCOPE
			)

			expect(bookingService.transitionItem).toHaveBeenCalledWith(tx, 44, "in_assessment", {
				actorId: "head-1",
				allowedFrom: ["pending_head_approval"],
			})
			expect(values).toHaveBeenCalledWith(
				expect.objectContaining({
					outcome: "returned",
					kind: "approval",
					notes: "Check the batch number",
				})
			)
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "assessment.send_back" }),
				tx
			)
		})

		it("refuses with 403 and audits it when the approver cleared the item themselves", async () => {
			selects(inScopeItem, [{ staffId: "head-1" }])

			await expect(
				processingService.decide(
					{ bookingItemId: 44, decision: "approve", notes: "" },
					"head-1",
					MANILA_SCOPE
				)
			).rejects.toMatchObject({ code: "FORBIDDEN" })
			expect(db.transaction).not.toHaveBeenCalled()
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "assessment.approve",
					outcome: "denied",
					actorId: "head-1",
					targetId: "44",
					reason: "own_assessment",
				})
			)
		})

		it("answers 404 for an item outside the approver's Scope and audits the denial", async () => {
			selects([{ id: 44, locationId: 9, serviceCategoryId: 1 }])

			await expect(
				processingService.decide(
					{ bookingItemId: 44, decision: "approve", notes: "" },
					"head-1",
					MANILA_SCOPE
				)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(bookingService.transitionItem).not.toHaveBeenCalled()
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", reason: "outside_scope" })
			)
		})

		it("saves nothing when the item is not waiting for approval", async () => {
			selects(inScopeItem, [{ staffId: "officer-1" }])
			const conflict = Object.assign(new Error("cannot be moved"), { code: "CONFLICT" })
			bookingService.transitionItem.mockRejectedValue(conflict)
			const values = mockDecisionInsert()

			await expect(
				processingService.decide(
					{ bookingItemId: 44, decision: "approve", notes: "" },
					"head-1",
					MANILA_SCOPE
				)
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(values).not.toHaveBeenCalled()
		})
	})

	describe("override (PRC-3)", () => {
		const reason = "Exemption letter verified by phone"

		it("clears a rejected item through BookingService and records the reason", async () => {
			selects(inScopeItem, [{ ...detailRow, status: "cleared" }], [])
			bookingService.overrideItem.mockResolvedValue({ from: "rejected", to: "cleared" })
			const values = mockDecisionInsert(12)

			const item = await processingService.override(
				{ bookingItemId: 44, reason },
				"head-1",
				MANILA_SCOPE
			)

			expect(bookingService.overrideItem).toHaveBeenCalledWith(tx, 44, "cleared", {
				actorId: "head-1",
				reason,
			})
			expect(values).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "cleared", kind: "override", notes: reason })
			)
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "assessment.override",
					oldValue: { status: "rejected" },
					newValue: { assessmentId: 12, status: "cleared" },
					reason,
				}),
				tx
			)
			expect(item.status).toBe("cleared")
		})

		it("answers 404 for an item outside the approver's Scope before any change", async () => {
			selects([{ id: 44, locationId: 9, serviceCategoryId: 1 }])

			await expect(
				processingService.override({ bookingItemId: 44, reason }, "head-1", MANILA_SCOPE)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(bookingService.overrideItem).not.toHaveBeenCalled()
			expect(auditService.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "assessment.override", outcome: "denied" })
			)
		})
	})
})
