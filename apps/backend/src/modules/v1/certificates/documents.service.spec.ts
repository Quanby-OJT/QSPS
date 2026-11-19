import { NotFoundException } from "@nestjs/common"

import { documentSequences, documents } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { PdfService } from "@/common/pdf/pdf.service"

import type { BookingService } from "../bookings/bookings.service"
import { icvRecord } from "./document-types/icv-record"
import { DocumentService } from "./documents.service"

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

/** 13:00 on Thursday 19 November 2026 in Manila. */
const NOW = new Date("2026-11-19T05:00:00.000Z")

/** A query that resolves to `rows` however it is finished. */
function query(rows: unknown[], onLock?: (mode: string) => void) {
	const chain: Record<string, unknown> = {}
	for (const step of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
		chain[step] = () => chain
	}
	chain.for = (mode: string) => {
		onLock?.(mode)
		return chain
	}
	chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
		Promise.resolve(rows).then(resolve, reject)
	return chain
}

/** A transaction whose selects answer in order and that records every write. */
function fakeTransaction(selects: unknown[][], returned: unknown[][] = []) {
	const locks: string[] = []
	const inserted: { table: unknown; values: unknown }[] = []
	const updated: { table: unknown; values: unknown }[] = []
	const selectQueue = [...selects]
	const returnQueue = [...returned]
	const tx = {
		select: jest.fn(() => query(selectQueue.shift() ?? [], mode => locks.push(mode))),
		insert: jest.fn((table: unknown) => ({
			values: (values: unknown) => {
				inserted.push({ table, values })
				const done = {
					onConflictDoNothing: () => done,
					returning: () => Promise.resolve(returnQueue.shift() ?? []),
					then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
				}
				return done
			},
		})),
		update: jest.fn((table: unknown) => ({
			set: (values: unknown) => {
				updated.push({ table, values })
				return { where: () => Promise.resolve(undefined) }
			},
		})),
	}
	return { tx, locks, inserted, updated }
}

const clearedItem = { id: 44, status: "cleared", bookingId: 31, serviceId: 1, locationId: 2 }
const context = {
	documentType: "icv-record",
	serviceName: "Yellow fever vaccination",
	locationCode: "MNL",
	locationName: "BOQ Manila",
	referenceNumber: "QSPS-261118-QZGKDE",
	holderName: "Test Three",
	holderBirthDate: "2003-07-12",
	holderGender: "Male",
	holderNationality: "Filipino",
}
const details = {
	batchNumber: "YF-24A",
	vaccinatorName: "Dr. Reyes",
	validFrom: "2026-11-29",
	validUntil: null,
	passportOrIdNumber: null,
}

describe("DocumentService", () => {
	let audit: { record: jest.Mock }
	let bookingService: { transitionItem: jest.Mock; completeIfAllItemsFinal: jest.Mock }
	let pdf: { render: jest.Mock; qrPng: jest.Mock }
	let service: DocumentService

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = {
			transitionItem: jest.fn().mockResolvedValue({ from: "cleared", to: "issued" }),
			completeIfAllItemsFinal: jest.fn().mockResolvedValue(true),
		}
		pdf = {
			qrPng: jest.fn().mockResolvedValue(Buffer.from("png")),
			render: jest.fn(async (_info: unknown, draw: (doc: unknown) => void) => {
				draw({})
				return Buffer.from("%PDF-1.3")
			}),
		}
		service = new DocumentService(
			audit as unknown as AuditService,
			bookingService as unknown as BookingService,
			pdf as unknown as PdfService
		)
	})

	describe("issue", () => {
		it("numbers, saves and issues the document, then moves the item and booking, in one transaction", async () => {
			const { tx, locks, inserted, updated } = fakeTransaction(
				[[clearedItem], [], [context], [{ id: 9, nextNumber: 1 }]],
				[[{ id: 5 }]]
			)

			const result = await service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				details,
				now: NOW,
			})

			expect(result.created).toBe(true)
			expect(result.document).toMatchObject({
				id: 5,
				documentType: "icv-record",
				documentNumber: "ICV-MNL-2026-000001",
				status: "valid",
				referenceNumber: "QSPS-261118-QZGKDE",
			})
			// The item and the sequence row are both locked.
			expect(locks).toEqual(["update", "update"])
			expect(inserted.map(entry => entry.table)).toEqual([documentSequences, documents])
			expect(inserted[1]?.values).toMatchObject({
				bookingItemId: 44,
				documentType: "icv-record",
				documentNumber: "ICV-MNL-2026-000001",
				verificationToken: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
				issuingLocationId: 2,
				issuedBy: "staff-1",
				status: "valid",
				source: "qsps",
				payload: expect.objectContaining({ batchNumber: "YF-24A", vaccinatorName: "Dr. Reyes" }),
			})
			expect(updated.map(entry => entry.table)).toEqual([documentSequences])
			expect(bookingService.transitionItem).toHaveBeenCalledWith(tx, 44, "issued", {
				actorId: "staff-1",
				allowedFrom: ["cleared"],
				now: NOW,
			})
			expect(bookingService.completeIfAllItemsFinal).toHaveBeenCalledWith(tx, 31, "staff-1", NOW)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "certificates",
					action: "document.issue",
					targetId: "5",
					newValue: expect.not.objectContaining({ payload: expect.anything() }),
				}),
				tx
			)
		})

		it("returns the existing document when the item already has one, changing nothing", async () => {
			const existing = {
				id: 5,
				documentType: "icv-record",
				documentNumber: "ICV-MNL-2026-000001",
				status: "valid",
				issuedAt: NOW,
				validUntil: null,
				serviceName: "Yellow fever vaccination",
				locationName: "BOQ Manila",
				referenceNumber: "QSPS-261118-QZGKDE",
			}
			const { tx, inserted } = fakeTransaction([[{ ...clearedItem, status: "issued" }], [existing]])

			const result = await service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				details,
				now: NOW,
			})

			expect(result).toEqual({ document: existing, created: false })
			expect(inserted).toEqual([])
			expect(bookingService.transitionItem).not.toHaveBeenCalled()
			expect(audit.record).not.toHaveBeenCalled()
		})

		it.each(["checked_in", "in_assessment", "pending_head_approval", "returned"])(
			"refuses an item that is %s",
			async status => {
				const { tx, inserted } = fakeTransaction([[{ ...clearedItem, status }], []])
				await expect(
					service.issue(tx as never, { bookingItemId: 44, actorId: "staff-1", details, now: NOW })
				).rejects.toMatchObject({ code: "CONFLICT" })
				expect(inserted).toEqual([])
			}
		)

		it("refuses a service whose document type QSPS cannot issue yet", async () => {
			const { tx, inserted } = fakeTransaction([
				[clearedItem],
				[],
				[{ ...context, documentType: "sanitary-permit" }],
			])
			await expect(
				service.issue(tx as never, { bookingItemId: 44, actorId: "staff-1", details, now: NOW })
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(inserted).toEqual([])
		})

		it("uses the next number in the sequence", async () => {
			const { tx } = fakeTransaction(
				[[clearedItem], [], [context], [{ id: 9, nextNumber: 124 }]],
				[[{ id: 6 }]]
			)
			const result = await service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				details,
				now: NOW,
			})
			expect(result.document.documentNumber).toBe("ICV-MNL-2026-000124")
		})
	})

	describe("issueOnClearance", () => {
		it("does nothing when the service does not auto-issue", async () => {
			const { tx } = fakeTransaction([[{ autoIssue: false, documentType: "icv-record" }]])
			await expect(
				service.issueOnClearance(tx as never, { bookingItemId: 44, actorId: "staff-1", now: NOW })
			).resolves.toBeNull()
		})

		it("does nothing when the service issues no document", async () => {
			const { tx } = fakeTransaction([[{ autoIssue: true, documentType: null }]])
			await expect(
				service.issueOnClearance(tx as never, { bookingItemId: 44, actorId: "staff-1", now: NOW })
			).resolves.toBeNull()
		})

		it("refuses when the certificate details are missing, so the clearance rolls back", async () => {
			const { tx } = fakeTransaction([[{ autoIssue: true, documentType: "icv-record" }]])
			await expect(
				service.issueOnClearance(tx as never, { bookingItemId: 44, actorId: "staff-1", now: NOW })
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
		})

		it("issues the document, recorded against the officer who cleared it", async () => {
			const { tx, inserted } = fakeTransaction(
				[
					[{ autoIssue: true, documentType: "icv-record" }],
					[clearedItem],
					[],
					[context],
					[{ id: 9, nextNumber: 1 }],
				],
				[[{ id: 5 }]]
			)
			const result = await service.issueOnClearance(tx as never, {
				bookingItemId: 44,
				actorId: "officer-7",
				details,
				now: NOW,
			})
			expect(result?.created).toBe(true)
			expect(inserted[1]?.values).toMatchObject({ issuedBy: "officer-7" })
		})
	})

	describe("issueAsStaff", () => {
		function dbSelects(...rowSets: unknown[][]) {
			const select = jest.mocked(db.select)
			select.mockReset()
			for (const rows of rowSets) select.mockReturnValueOnce(query(rows) as never)
		}

		it("answers 404 for an item at another Location and audits the denial", async () => {
			dbSelects([{ id: 44, locationId: 2 }], [{ locationId: 9 }])
			await expect(
				service.issueAsStaff({ bookingItemId: 44, details }, "staff-1")
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(db.transaction).not.toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.issue",
					outcome: "denied",
					targetType: "booking_item",
					targetId: "44",
					reason: "outside_scope",
				})
			)
		})

		it("answers 404 for a staff user with no Location", async () => {
			dbSelects([{ id: 44, locationId: 2 }], [])
			await expect(
				service.issueAsStaff({ bookingItemId: 44, details }, "staff-1")
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ reason: "no_location" }))
		})

		it("refuses a request with no signed-in user", async () => {
			await expect(
				service.issueAsStaff({ bookingItemId: 44, details }, null)
			).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		})
	})

	describe("renderForOwner", () => {
		const row = {
			documentNumber: "ICV-MNL-2026-000001",
			documentType: "icv-record",
			status: "valid",
			verificationToken: "AbCdEfGhIjKlMnOpQrSt_-",
			payload: { holder: { name: "Test Three" } },
			clientId: "client-1",
		}

		it("renders the owner's document with a QR code to the verify page", async () => {
			jest.mocked(db.select).mockReset().mockReturnValueOnce(query([row]) as never)
			const draw = jest.spyOn(icvRecord, "draw").mockImplementation(() => undefined)

			const result = await service.renderForOwner(5, "client-1")

			expect(result).toEqual({ fileName: "ICV-MNL-2026-000001.pdf", pdf: Buffer.from("%PDF-1.3") })
			expect(pdf.qrPng).toHaveBeenCalledWith("http://localhost:3001/verify/AbCdEfGhIjKlMnOpQrSt_-")
			expect(draw).toHaveBeenCalledWith(
				{},
				row.payload,
				expect.objectContaining({ documentNumber: "ICV-MNL-2026-000001", status: "valid" })
			)
			draw.mockRestore()
		})

		it("answers 404 and audits a denial when another client asks", async () => {
			jest.mocked(db.select).mockReset().mockReturnValueOnce(query([row]) as never)
			await expect(service.renderForOwner(5, "client-2")).rejects.toBeInstanceOf(NotFoundException)
			expect(pdf.render).not.toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.read",
					outcome: "denied",
					actorId: "client-2",
					reason: "not_owner",
				})
			)
		})
	})
})