import { ConflictException, NotFoundException } from "@nestjs/common"

import { documents, documentSequences } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import type { PdfService } from "@/common/pdf/pdf.service"
import { readableAnswers } from "@/modules/v1/forms/form-answers-display"

import type { BookingService } from "../bookings/bookings.service"
import { icvCardLayout } from "./document-types/icv-card"
import { icvRecord } from "./document-types/icv-record"
import { medicalExemption } from "./document-types/medical-exemption"
import { sanitaryPermit } from "./document-types/sanitary-permit"
import { DocumentService } from "./documents.service"

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
	db: { select: jest.fn(), transaction: jest.fn() },
}))
jest.mock("@/config/env.config", () => ({
	env: { APP_WEB_URL: "http://localhost:3001" },
}))
// CRT-5: the sanitation documents are built from the client's questionnaire answers.
jest.mock("@/modules/v1/forms/form-answers-display", () => ({
	readableAnswers: jest.fn(),
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
const permitContext = {
	...context,
	documentType: "sanitary-permit",
	serviceName: "Sanitary Permit",
}
const shipContext = {
	...context,
	documentType: "ship-sanitation",
	serviceName: "Ship Sanitation Certificate",
}
const permitDetails = { validFrom: "2026-12-01", validUntil: "2027-11-30" }
const shipDetails = {
	findings: "Galley, potable water and waste systems inspected; no infestation found.",
	validFrom: "2026-12-01",
	validUntil: "2027-05-31",
}
const permitAnswers = {
	"Establishment name": "Mercado Fresh Foods",
	"Type of establishment": "Restaurant",
	"Owner or operator": "Ana Reyes",
	"Business address": "12 Rizal St, Manila",
	"Contact number": "Not answered",
}
const shipAnswers = {
	"Vessel name": "MV Pacific Star",
	"Type of vessel": "Cargo ship",
	"Registry or IMO number": "IMO 9321483",
	"Flag or port of registry": "Manila",
	"Gross tonnage": "Not answered",
	"Master or agent": "Capt. Dela Cruz",
	"Last port of call": "Cebu",
}
const exemption = {
	reason: "Egg allergy (anaphylaxis)",
	physicianName: "Dr. Santos",
	validFrom: "2026-11-29",
	validUntil: "2027-11-28",
	passportOrIdNumber: "P1234567A",
}

describe("DocumentService", () => {
	let audit: { record: jest.Mock }
	let bookingService: { transitionItem: jest.Mock; completeIfAllItemsFinal: jest.Mock }
	let pdf: { render: jest.Mock; qrPng: jest.Mock }
	let service: DocumentService

	beforeEach(() => {
		jest.clearAllMocks()
		jest.spyOn(NotificationService, "enqueue").mockResolvedValue(undefined)
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

		it("issues a Medical Exemption Certificate, with its own number series, for an exempt client (CRT-3)", async () => {
			const { tx, inserted } = fakeTransaction(
				[[clearedItem], [], [context], [{ id: 10, nextNumber: 1 }]],
				[[{ id: 7 }]]
			)

			const result = await service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				exemption,
				now: NOW,
			})

			expect(result.document).toMatchObject({
				id: 7,
				documentType: "medical-exemption",
				documentNumber: "MEC-MNL-2026-000001",
				validUntil: "2027-11-28",
			})
			// Its own sequence row: the type is part of the sequence key.
			expect(inserted[0]?.values).toMatchObject({
				documentType: "medical-exemption",
				locationId: 2,
			})
			expect(inserted[1]?.values).toMatchObject({
				documentType: "medical-exemption",
				documentNumber: "MEC-MNL-2026-000001",
				verificationToken: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
				validUntil: "2027-11-28",
				payload: expect.objectContaining({
					exemptFrom: "Yellow fever vaccination",
					reason: "Egg allergy (anaphylaxis)",
					physicianName: "Dr. Santos",
				}),
			})
			expect(bookingService.transitionItem).toHaveBeenCalledWith(
				tx,
				44,
				"issued",
				expect.anything()
			)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.issue",
					newValue: expect.objectContaining({ documentType: "medical-exemption" }),
				}),
				tx
			)
		})

		it("refuses an issue with neither vaccination nor exemption details", async () => {
			const { tx, inserted } = fakeTransaction([[clearedItem], [], [context]])
			await expect(
				service.issue(tx as never, { bookingItemId: 44, actorId: "staff-1", now: NOW })
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(inserted).toEqual([])
		})

		it("never lets a Service issue the exemption as its own type (CRT-3)", async () => {
			const { tx, inserted } = fakeTransaction([
				[clearedItem],
				[],
				[{ ...context, documentType: "medical-exemption" }],
			])
			await expect(
				service.issue(tx as never, { bookingItemId: 44, actorId: "staff-1", exemption, now: NOW })
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

		describe("sanitation documents (CRT-5)", () => {
			it("issues a Sanitary Permit built from the client's answers, with its own number series and validity", async () => {
				jest.mocked(readableAnswers).mockResolvedValue(permitAnswers)
				const { tx, inserted } = fakeTransaction(
					[[clearedItem], [], [permitContext], [{ id: 11, nextNumber: 1 }]],
					[[{ id: 12 }]]
				)

				const result = await service.issue(tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					sanitaryPermit: permitDetails,
					now: NOW,
				})

				expect(readableAnswers).toHaveBeenCalledWith(tx, 44)
				expect(result.document).toMatchObject({
					id: 12,
					documentType: "sanitary-permit",
					documentNumber: "SPM-MNL-2026-000001",
					status: "valid",
					validUntil: "2027-11-30",
				})
				expect(inserted[0]?.values).toMatchObject({
					documentType: "sanitary-permit",
					locationId: 2,
				})
				expect(inserted[1]?.values).toMatchObject({
					documentType: "sanitary-permit",
					documentNumber: "SPM-MNL-2026-000001",
					verificationToken: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
					validUntil: "2027-11-30",
					status: "valid",
					issuedBy: "staff-1",
					payload: {
						holder: { name: "Mercado Fresh Foods" },
						establishmentType: "Restaurant",
						ownerName: "Ana Reyes",
						address: "12 Rizal St, Manila",
						contactNumber: null,
						serviceName: "Sanitary Permit",
						dateIssued: "2026-11-19",
						validFrom: "2026-12-01",
						validUntil: "2027-11-30",
						issuingStation: "BOQ Manila",
					},
				})
				expect(bookingService.transitionItem).toHaveBeenCalledWith(
					tx,
					44,
					"issued",
					expect.anything()
				)
				expect(audit.record).toHaveBeenCalledWith(
					expect.objectContaining({
						action: "document.issue",
						newValue: expect.not.objectContaining({ payload: expect.anything() }),
					}),
					tx
				)
			})

			it("issues a Ship Sanitation Certificate with the officer's findings and validity", async () => {
				jest.mocked(readableAnswers).mockResolvedValue(shipAnswers)
				const { tx, inserted } = fakeTransaction(
					[[clearedItem], [], [shipContext], [{ id: 13, nextNumber: 4 }]],
					[[{ id: 14 }]]
				)

				const result = await service.issue(tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					shipSanitation: shipDetails,
					now: NOW,
				})

				expect(result.document).toMatchObject({
					documentType: "ship-sanitation",
					documentNumber: "SSC-MNL-2026-000004",
					validUntil: "2027-05-31",
				})
				expect(inserted[1]?.values).toMatchObject({
					documentType: "ship-sanitation",
					validUntil: "2027-05-31",
					payload: expect.objectContaining({
						holder: { name: "MV Pacific Star" },
						registryNumber: "IMO 9321483",
						registryPort: "Manila",
						grossTonnage: null,
						findings: shipDetails.findings,
					}),
				})
			})

			it("refuses an item that is not cleared, before reading any answer or saving anything", async () => {
				const { tx, inserted } = fakeTransaction([
					[{ ...clearedItem, status: "in_assessment" }],
					[],
				])
				await expect(
					service.issue(tx as never, {
						bookingItemId: 44,
						actorId: "staff-1",
						sanitaryPermit: permitDetails,
						now: NOW,
					})
				).rejects.toMatchObject({ code: "CONFLICT" })
				expect(readableAnswers).not.toHaveBeenCalled()
				expect(inserted).toEqual([])
				expect(bookingService.transitionItem).not.toHaveBeenCalled()
			})

			it("refuses a permit for a Service that issues another document, and the reverse", async () => {
				const forVaccination = fakeTransaction([[clearedItem], [], [context]])
				await expect(
					service.issue(forVaccination.tx as never, {
						bookingItemId: 44,
						actorId: "staff-1",
						sanitaryPermit: permitDetails,
						now: NOW,
					})
				).rejects.toMatchObject({ code: "CONFLICT" })
				expect(forVaccination.inserted).toEqual([])

				const forPermit = fakeTransaction([[clearedItem], [], [permitContext]])
				await expect(
					service.issue(forPermit.tx as never, {
						bookingItemId: 44,
						actorId: "staff-1",
						details,
						now: NOW,
					})
				).rejects.toMatchObject({ code: "CONFLICT" })
				expect(forPermit.inserted).toEqual([])

				const forShip = fakeTransaction([[clearedItem], [], [shipContext]])
				await expect(
					service.issue(forShip.tx as never, {
						bookingItemId: 44,
						actorId: "staff-1",
						sanitaryPermit: permitDetails,
						now: NOW,
					})
				).rejects.toMatchObject({ code: "CONFLICT" })
				expect(forShip.inserted).toEqual([])
			})

			it("never issues the exemption for a sanitation Service", async () => {
				const { tx, inserted } = fakeTransaction([[clearedItem], [], [permitContext]])
				await expect(
					service.issue(tx as never, {
						bookingItemId: 44,
						actorId: "staff-1",
						exemption,
						now: NOW,
					})
				).rejects.toMatchObject({ code: "CONFLICT" })
				expect(inserted).toEqual([])
			})

			it("names the missing question when the client left a required answer out, saving nothing", async () => {
				jest.mocked(readableAnswers).mockResolvedValue({
					...permitAnswers,
					"Business address": "Not answered",
				})
				const { tx, inserted } = fakeTransaction([[clearedItem], [], [permitContext]])

				const outcome = service.issue(tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					sanitaryPermit: permitDetails,
					now: NOW,
				})

				await expect(outcome).rejects.toMatchObject({ code: "CONFLICT" })
				await expect(outcome).rejects.toThrow("Business address")
				expect(inserted).toEqual([])
				expect(bookingService.transitionItem).not.toHaveBeenCalled()
			})

			it("asks for the validity dates when a sanitation Service gets no details", async () => {
				const { tx, inserted } = fakeTransaction([[clearedItem], [], [permitContext]])
				await expect(
					service.issue(tx as never, { bookingItemId: 44, actorId: "staff-1", now: NOW })
				).rejects.toMatchObject({ code: "BAD_REQUEST" })
				expect(inserted).toEqual([])
			})
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

		it("refuses an exemption when the service does not auto-issue, so it is never dropped (CRT-3)", async () => {
			const { tx } = fakeTransaction([[{ autoIssue: false, documentType: "icv-record" }]])
			await expect(
				service.issueOnClearance(tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					exemption,
					now: NOW,
				})
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
		})

		it("issues the exemption instead of the record when one is given (CRT-3)", async () => {
			const { tx, inserted } = fakeTransaction(
				[
					[{ autoIssue: true, documentType: "icv-record" }],
					[clearedItem],
					[],
					[context],
					[{ id: 10, nextNumber: 3 }],
				],
				[[{ id: 8 }]]
			)
			const result = await service.issueOnClearance(tx as never, {
				bookingItemId: 44,
				actorId: "officer-7",
				details: null,
				exemption,
				now: NOW,
			})
			expect(result?.document.documentNumber).toBe("MEC-MNL-2026-000003")
			expect(inserted[1]?.values).toMatchObject({
				documentType: "medical-exemption",
				issuedBy: "officer-7",
			})
		})

		it("never issues a sanitation document on clearance, even with auto-issue switched on (CRT-5)", async () => {
			const { tx, inserted } = fakeTransaction([
				[{ autoIssue: true, documentType: "sanitary-permit" }],
			])
			await expect(
				service.issueOnClearance(tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					now: NOW,
				})
			).resolves.toBeNull()
			expect(inserted).toEqual([])
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
				service.issueAsStaff(
					{
						bookingItemId: 44,
						details,
						exemption: null,
						sanitaryPermit: null,
						shipSanitation: null,
					},
					"staff-1"
				)
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
				service.issueAsStaff(
					{
						bookingItemId: 44,
						details,
						exemption: null,
						sanitaryPermit: null,
						shipSanitation: null,
					},
					"staff-1"
				)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ reason: "no_location" }))
		})

		it("answers 404 for a sanitation item at another Location and audits the denial (CRT-5)", async () => {
			dbSelects([{ id: 44, locationId: 2 }], [{ locationId: 9 }])
			await expect(
				service.issueAsStaff(
					{
						bookingItemId: 44,
						details: null,
						exemption: null,
						sanitaryPermit: permitDetails,
						shipSanitation: null,
					},
					"staff-1"
				)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(db.transaction).not.toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.issue",
					outcome: "denied",
					targetId: "44",
					reason: "outside_scope",
				})
			)
		})

		it("refuses a request with no signed-in user", async () => {
			await expect(
				service.issueAsStaff(
					{
						bookingItemId: 44,
						details,
						exemption: null,
						sanitaryPermit: null,
						shipSanitation: null,
					},
					null
				)
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
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query([row]) as never)
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
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query([row]) as never)
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

	describe("printForStaff", () => {
		const MANILA_YF = {
			nationwide: false,
			entries: [{ serviceCategoryId: 1, locationId: 2 }],
		} as const
		const printRow = {
			id: 5,
			documentNumber: "ICV-MNL-2026-000001",
			documentType: "icv-record",
			status: "valid",
			verificationToken: "AbCdEfGhIjKlMnOpQrSt_-",
			payload: { holder: { name: "Test Three" } },
			printCount: 0,
			locationId: 2,
			cardOffsetXMm: 1.5,
			cardOffsetYMm: -2,
			serviceCategoryId: 1,
		}

		/** db.select answers `rows`; the print transaction's update answers `counted`. */
		function arrange(rows: unknown[], counted: unknown[] = [{ printCount: 1 }]) {
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query(rows) as never)
			const set = jest.fn(() => ({
				where: () => ({ returning: () => Promise.resolve(counted) }),
			}))
			const tx = { update: jest.fn(() => ({ set })) }
			jest
				.mocked(db.transaction)
				.mockReset()
				.mockImplementation((async (run: (t: unknown) => unknown) => run(tx)) as never)
			return { tx, set }
		}

		it("prints the vaccination record on the card layout, shifted by the Location's offsets, and counts it", async () => {
			const { tx, set } = arrange([printRow])
			const draw = jest.spyOn(icvCardLayout, "draw").mockImplementation(() => undefined)

			const result = await service.printForStaff(5, "staff-1", MANILA_YF as never)

			expect(result).toEqual({
				fileName: "ICV-MNL-2026-000001.pdf",
				pdf: Buffer.from("%PDF-1.3"),
				printCount: 1,
			})
			expect(pdf.render).toHaveBeenCalledWith(
				expect.objectContaining({ size: icvCardLayout.size, margin: 0 }),
				expect.any(Function)
			)
			expect(draw).toHaveBeenCalledWith(
				{},
				printRow.payload,
				expect.objectContaining({ documentNumber: "ICV-MNL-2026-000001" }),
				{ xMm: 1.5, yMm: -2 }
			)
			expect(set).toHaveBeenCalledWith({ printCount: expect.anything() })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "certificates",
					action: "document.print",
					actorId: "staff-1",
					targetType: "document",
					targetId: "5",
					oldValue: { printCount: 0 },
					newValue: expect.objectContaining({ layout: "card", printCount: 1, reprint: false }),
				}),
				tx
			)
			draw.mockRestore()
		})

		it("marks every print after the first as a reprint", async () => {
			arrange([{ ...printRow, printCount: 2 }], [{ printCount: 3 }])
			const draw = jest.spyOn(icvCardLayout, "draw").mockImplementation(() => undefined)

			const result = await service.printForStaff(5, "staff-1", MANILA_YF as never)

			expect(result.printCount).toBe(3)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.print",
					newValue: expect.objectContaining({ printCount: 3, reprint: true }),
				}),
				expect.anything()
			)
			draw.mockRestore()
		})

		it("prints a Medical Exemption Certificate on A4", async () => {
			arrange([
				{ ...printRow, documentType: "medical-exemption", documentNumber: "MEC-MNL-2026-000001" },
			])
			const draw = jest.spyOn(medicalExemption, "draw").mockImplementation(() => undefined)

			await service.printForStaff(5, "staff-1", MANILA_YF as never)

			expect(pdf.render).toHaveBeenCalledWith(
				{ title: "Medical Exemption Certificate MEC-MNL-2026-000001" },
				expect.any(Function)
			)
			expect(draw).toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ newValue: expect.objectContaining({ layout: "a4" }) }),
				expect.anything()
			)
			draw.mockRestore()
		})

		it("prints a Sanitary Permit on A4 (CRT-5)", async () => {
			arrange([
				{ ...printRow, documentType: "sanitary-permit", documentNumber: "SPM-MNL-2026-000001" },
			])
			const draw = jest.spyOn(sanitaryPermit, "draw").mockImplementation(() => undefined)

			await service.printForStaff(5, "staff-1", MANILA_YF as never)

			expect(pdf.render).toHaveBeenCalledWith(
				{ title: "Sanitary Permit SPM-MNL-2026-000001" },
				expect.any(Function)
			)
			expect(draw).toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ newValue: expect.objectContaining({ layout: "a4" }) }),
				expect.anything()
			)
			draw.mockRestore()
		})

		it("answers 404 for a document outside the caller's Scope and audits the denial", async () => {
			arrange([{ ...printRow, locationId: 9 }])

			await expect(service.printForStaff(5, "staff-1", MANILA_YF as never)).rejects.toBeInstanceOf(
				NotFoundException
			)
			expect(pdf.render).not.toHaveBeenCalled()
			expect(db.transaction).not.toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.print",
					outcome: "denied",
					actorId: "staff-1",
					targetId: "5",
					reason: "outside_scope",
				})
			)
		})

		it("answers 404 without an audit entry when the document does not exist", async () => {
			arrange([])
			await expect(service.printForStaff(99, "staff-1")).rejects.toBeInstanceOf(NotFoundException)
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("refuses to print a revoked document, counting nothing", async () => {
			arrange([{ ...printRow, status: "revoked" }])
			await expect(service.printForStaff(5, "staff-1", MANILA_YF as never)).rejects.toBeInstanceOf(
				ConflictException
			)
			expect(pdf.render).not.toHaveBeenCalled()
			expect(db.transaction).not.toHaveBeenCalled()
		})

		it("counts nothing when the document was revoked after it was read", async () => {
			arrange([printRow], [])
			const draw = jest.spyOn(icvCardLayout, "draw").mockImplementation(() => undefined)
			await expect(service.printForStaff(5, "staff-1", MANILA_YF as never)).rejects.toBeInstanceOf(
				ConflictException
			)
			expect(audit.record).not.toHaveBeenCalled()
			draw.mockRestore()
		})
	})
})
