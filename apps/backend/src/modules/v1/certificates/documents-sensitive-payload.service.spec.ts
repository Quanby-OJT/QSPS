import { ConflictException, NotFoundException } from "@nestjs/common"

import { documents } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import type { PdfService } from "@/common/pdf/pdf.service"
import { env } from "@/config/env.config"
import { readableAnswers } from "@/modules/v1/forms/form-answers-display"

import type { BookingService } from "../bookings/bookings.service"
import { humanRemains } from "./document-types/human-remains"
import { DocumentService } from "./documents.service"
import { maskName } from "./mask-name"
import {
	isSealedPayload,
	openPayload,
	parsePayloadKey,
	payloadAad,
	PayloadDecryptError,
	PayloadKeyError,
	sealPayload,
} from "./payload-cipher"

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
const KEY_TEXT = Buffer.alloc(32, 7).toString("base64")
jest.mock("@/config/env.config", () => ({
	env: {
		APP_WEB_URL: "http://localhost:3001",
		DOCUMENT_PAYLOAD_KEY: Buffer.alloc(32, 7).toString("base64"),
	},
}))
jest.mock("@/modules/v1/forms/form-answers-display", () => ({
	readableAnswers: jest.fn(),
}))

/** 13:00 on Thursday 19 November 2026 in Manila. */
const NOW = new Date("2026-11-19T05:00:00.000Z")
const settings = env as { DOCUMENT_PAYLOAD_KEY: string | undefined }

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

/** A transaction whose selects answer in order and that records every write. */
function fakeTransaction(selects: unknown[][], returned: unknown[][] = []) {
	const inserted: { table: unknown; values: unknown }[] = []
	const selectQueue = [...selects]
	const returnQueue = [...returned]
	const tx = {
		select: jest.fn(() => query(selectQueue.shift() ?? [])),
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
		update: jest.fn(() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
	}
	return { tx, inserted }
}

const clearedItem = { id: 44, status: "cleared", bookingId: 31, serviceId: 1, locationId: 2 }
const baseContext = {
	serviceName: "Human Remains Transport Clearance",
	locationCode: "MNL",
	locationName: "BOQ Manila",
	referenceNumber: "QSPS-261118-QZGKDE",
	holderName: "Maria Dela Cruz",
	holderBirthDate: "1990-02-03",
	holderGender: "Female",
	holderNationality: "Filipino",
	sessionStartsAt: new Date("2026-11-25T06:00:00.000Z"),
	sessionEndsAt: new Date("2026-11-25T09:00:00.000Z"),
}
const remainsContext = { ...baseContext, documentType: "human-remains" }
const certificationContext = {
	...baseContext,
	documentType: "biological-certification",
	serviceName: "Biological Substance Certification",
}
const permitContext = {
	...baseContext,
	documentType: "biological-permit",
	serviceName: "Biological Substance Permit",
}
const remainsAnswers = {
	"Name of the deceased": "Juan Dela Cruz",
	"Date of death": "2026-11-15",
	"Cause of death": "Cardiac arrest",
	"Embalmed or cremated": "Embalmed",
	"Consignee name": "Maria Dela Cruz",
	"Consignee address": "45 Mabini St, Cebu City",
	"Consignee contact number": "Not answered",
	"Origin": "Manila",
	"Destination": "Cebu",
	"Carrier, flight or vessel": "PR 2105",
	"Date of transport": "2026-11-20",
}
const biologicalAnswers = {
	"Substance or specimen": "Human blood samples",
	"Quantity": "20 vials, 5 ml each",
	"Origin": "Manila, Philippines",
	"Destination": "Singapore",
	"Sender or shipper": "Philippine General Hospital",
	"Consignee": "Not answered",
	"Purpose": "Not answered",
}
const permitDetails = { validFrom: "2026-12-01", validUntil: "2027-11-30" }
const key = () => parsePayloadKey(KEY_TEXT)

describe("DocumentService, human remains and biological documents (CRT-7)", () => {
	let audit: { record: jest.Mock }
	let bookingService: { transitionItem: jest.Mock; completeIfAllItemsFinal: jest.Mock }
	let pdf: { render: jest.Mock; qrPng: jest.Mock }
	let service: DocumentService

	beforeEach(() => {
		jest.clearAllMocks()
		settings.DOCUMENT_PAYLOAD_KEY = KEY_TEXT
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
		it("issues a Human Remains Certificate with the payload stored encrypted", async () => {
			jest.mocked(readableAnswers).mockResolvedValue(remainsAnswers)
			const { tx, inserted } = fakeTransaction(
				[[clearedItem], [], [remainsContext], [{ id: 9, nextNumber: 1 }]],
				[[{ id: 5 }]]
			)

			const result = await service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				humanRemains: {},
				now: NOW,
			})

			expect(readableAnswers).toHaveBeenCalledWith(tx, 44)
			expect(result.created).toBe(true)
			expect(result.document).toMatchObject({
				id: 5,
				documentType: "human-remains",
				documentNumber: "HRC-MNL-2026-000001",
				status: "valid",
				validUntil: null,
			})
			const row = inserted.find(entry => entry.table === documents)?.values as {
				payload: Record<string, unknown>
				documentType: string
			}
			expect(row.documentType).toBe("human-remains")
			expect(isSealedPayload(row.payload)).toBe(true)
			// Nothing readable reaches the database column.
			const stored = JSON.stringify(row.payload)
			for (const secret of ["Juan", "Cardiac", "Mabini", "Cebu", "holder"]) {
				expect(stored).not.toContain(secret)
			}
			// It opens with the key, under this document's own type and number.
			expect(
				openPayload(row.payload, key, payloadAad("human-remains", "HRC-MNL-2026-000001"))
			).toMatchObject({
				holder: { name: "Juan Dela Cruz" },
				deceased: { causeOfDeath: "Cardiac arrest" },
				consignee: { address: "45 Mabini St, Cebu City" },
			})
			expect(bookingService.transitionItem).toHaveBeenCalledWith(
				tx,
				44,
				"issued",
				expect.anything()
			)
		})

		it("keeps the payload out of the audit entry", async () => {
			jest.mocked(readableAnswers).mockResolvedValue(remainsAnswers)
			const { tx } = fakeTransaction(
				[[clearedItem], [], [remainsContext], [{ id: 9, nextNumber: 1 }]],
				[[{ id: 5 }]]
			)
			await service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				humanRemains: {},
				now: NOW,
			})
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.issue",
					newValue: {
						bookingItemId: 44,
						documentType: "human-remains",
						documentNumber: "HRC-MNL-2026-000001",
						issuingLocationId: 2,
					},
				}),
				tx
			)
			expect(JSON.stringify(audit.record.mock.calls)).not.toContain("Cardiac")
		})

		it("issues a Biological Substance Certification, encrypted, with its own number series", async () => {
			jest.mocked(readableAnswers).mockResolvedValue(biologicalAnswers)
			const { tx, inserted } = fakeTransaction(
				[[clearedItem], [], [certificationContext], [{ id: 9, nextNumber: 3 }]],
				[[{ id: 6 }]]
			)

			const result = await service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				biologicalCertification: {},
				now: NOW,
			})

			expect(result.document).toMatchObject({
				documentType: "biological-certification",
				documentNumber: "BCT-MNL-2026-000003",
				validUntil: null,
			})
			const row = inserted.find(entry => entry.table === documents)?.values as {
				payload: Record<string, unknown>
			}
			expect(isSealedPayload(row.payload)).toBe(true)
			expect(JSON.stringify(row.payload)).not.toContain("blood")
			expect(
				openPayload(row.payload, key, payloadAad("biological-certification", "BCT-MNL-2026-000003"))
			).toMatchObject({
				substance: "Human blood samples",
				quantity: "20 vials, 5 ml each",
				origin: "Manila, Philippines",
				destination: "Singapore",
			})
		})

		it("issues a Biological Substance Permit valid until the officer's end date, encrypted", async () => {
			jest.mocked(readableAnswers).mockResolvedValue(biologicalAnswers)
			const { tx, inserted } = fakeTransaction(
				[[clearedItem], [], [permitContext], [{ id: 9, nextNumber: 1 }]],
				[[{ id: 7 }]]
			)

			const result = await service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				biologicalPermit: permitDetails,
				now: NOW,
			})

			expect(result.document).toMatchObject({
				documentType: "biological-permit",
				documentNumber: "BPM-MNL-2026-000001",
				validUntil: "2027-11-30",
			})
			const row = inserted.find(entry => entry.table === documents)?.values as {
				payload: Record<string, unknown>
				validUntil: string
			}
			// The column the expiry check reads stays readable; only the payload is sealed.
			expect(row.validUntil).toBe("2027-11-30")
			expect(isSealedPayload(row.payload)).toBe(true)
			expect(
				openPayload(row.payload, key, payloadAad("biological-permit", "BPM-MNL-2026-000001"))
			).toMatchObject({ validFrom: "2026-12-01", validUntil: "2027-11-30" })
		})

		it("refuses to issue, saving no document, when DOCUMENT_PAYLOAD_KEY is not set", async () => {
			settings.DOCUMENT_PAYLOAD_KEY = undefined
			jest.mocked(readableAnswers).mockResolvedValue(remainsAnswers)
			const { tx, inserted } = fakeTransaction(
				[[clearedItem], [], [remainsContext], [{ id: 9, nextNumber: 1 }]],
				[[{ id: 5 }]]
			)

			await expect(
				service.issue(tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					humanRemains: {},
					now: NOW,
				})
			).rejects.toBeInstanceOf(PayloadKeyError)

			expect(inserted.some(entry => entry.table === documents)).toBe(false)
			expect(bookingService.transitionItem).not.toHaveBeenCalled()
		})

		it("names the missing question when the deceased's details are incomplete", async () => {
			jest.mocked(readableAnswers).mockResolvedValue({
				...remainsAnswers,
				"Cause of death": "Not answered",
			})
			const { tx, inserted } = fakeTransaction([[clearedItem], [], [remainsContext]])
			const outcome = service.issue(tx as never, {
				bookingItemId: 44,
				actorId: "staff-1",
				humanRemains: {},
				now: NOW,
			})
			await expect(outcome).rejects.toMatchObject({ code: "CONFLICT" })
			await expect(outcome).rejects.toThrow("Cause of death")
			expect(inserted).toEqual([])
		})

		it("refuses details for another document type, and the reverse", async () => {
			const remainsForPermit = fakeTransaction([[clearedItem], [], [permitContext]])
			await expect(
				service.issue(remainsForPermit.tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					humanRemains: {},
					now: NOW,
				})
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(remainsForPermit.inserted).toEqual([])

			const permitForRemains = fakeTransaction([[clearedItem], [], [remainsContext]])
			await expect(
				service.issue(permitForRemains.tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					biologicalPermit: permitDetails,
					now: NOW,
				})
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(permitForRemains.inserted).toEqual([])
		})

		it("asks for the validity dates when a permit Service gets no details", async () => {
			const { tx, inserted } = fakeTransaction([[clearedItem], [], [permitContext]])
			await expect(
				service.issue(tx as never, { bookingItemId: 44, actorId: "staff-1", now: NOW })
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(inserted).toEqual([])
		})

		it("refuses an item that is not cleared, saving nothing", async () => {
			const { tx, inserted } = fakeTransaction([[{ ...clearedItem, status: "in_assessment" }], []])
			await expect(
				service.issue(tx as never, {
					bookingItemId: 44,
					actorId: "staff-1",
					humanRemains: {},
					now: NOW,
				})
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(readableAnswers).not.toHaveBeenCalled()
			expect(inserted).toEqual([])
		})
	})

	describe("renderForOwner", () => {
		function sealedRow() {
			const payload = { holder: { name: "Juan Dela Cruz" }, deceased: { name: "Juan Dela Cruz" } }
			return {
				documentNumber: "HRC-MNL-2026-000001",
				documentType: "human-remains",
				status: "valid",
				verificationToken: "AbCdEfGhIjKlMnOpQrSt_-",
				payload: sealPayload(payload, key(), payloadAad("human-remains", "HRC-MNL-2026-000001")),
				clientId: "client-1",
				plain: payload,
			}
		}

		it("draws the PDF from the decrypted payload, never from the stored envelope", async () => {
			const { plain, ...row } = sealedRow()
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query([row]) as never)
			const draw = jest.spyOn(humanRemains, "draw").mockImplementation(() => undefined)

			await service.renderForOwner(5, "client-1")

			expect(draw).toHaveBeenCalledWith(
				{},
				plain,
				expect.objectContaining({ documentNumber: "HRC-MNL-2026-000001" })
			)
			draw.mockRestore()
		})

		it("will not draw a payload moved to another document's row", async () => {
			const { plain: _plain, ...row } = sealedRow()
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query([{ ...row, documentNumber: "HRC-MNL-2026-000002" }]) as never)
			await expect(service.renderForOwner(5, "client-1")).rejects.toBeInstanceOf(
				PayloadDecryptError
			)
			expect(pdf.render).not.toHaveBeenCalled()
		})

		it("answers 404 to another client before touching the payload, even without the key", async () => {
			settings.DOCUMENT_PAYLOAD_KEY = undefined
			const { plain: _plain, ...row } = sealedRow()
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query([row]) as never)
			await expect(service.renderForOwner(5, "client-2")).rejects.toBeInstanceOf(NotFoundException)
			expect(pdf.render).not.toHaveBeenCalled()
		})
	})

	describe("printForStaff", () => {
		const scope = { nationwide: false, entries: [{ serviceCategoryId: 1, locationId: 2 }] } as const

		function printRow() {
			const payload = { holder: { name: "Juan Dela Cruz" } }
			return {
				plain: payload,
				row: {
					id: 5,
					documentNumber: "HRC-MNL-2026-000001",
					documentType: "human-remains",
					status: "valid",
					verificationToken: "AbCdEfGhIjKlMnOpQrSt_-",
					payload: sealPayload(payload, key(), payloadAad("human-remains", "HRC-MNL-2026-000001")),
					printCount: 0,
					locationId: 2,
					cardOffsetXMm: 0,
					cardOffsetYMm: 0,
					serviceCategoryId: 1,
				},
			}
		}

		function arrange(rows: unknown[]) {
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query(rows) as never)
			const set = jest.fn(() => ({
				where: () => ({ returning: () => Promise.resolve([{ printCount: 1 }]) }),
			}))
			const tx = { update: jest.fn(() => ({ set })) }
			jest
				.mocked(db.transaction)
				.mockReset()
				.mockImplementation((async (run: (t: unknown) => unknown) => run(tx)) as never)
		}

		it("prints the decrypted payload and audits the print without it", async () => {
			const { row, plain } = printRow()
			arrange([row])
			const draw = jest.spyOn(humanRemains, "draw").mockImplementation(() => undefined)

			const result = await service.printForStaff(5, "staff-1", scope as never)

			expect(result.printCount).toBe(1)
			expect(draw).toHaveBeenCalledWith({}, plain, expect.anything())
			expect(JSON.stringify(audit.record.mock.calls)).not.toContain("Juan")
			draw.mockRestore()
		})

		it("answers 404 outside the caller's Scope and audits it, without decrypting anything", async () => {
			settings.DOCUMENT_PAYLOAD_KEY = undefined
			const { row } = printRow()
			arrange([{ ...row, locationId: 9 }])

			await expect(service.printForStaff(5, "staff-1", scope as never)).rejects.toBeInstanceOf(
				NotFoundException
			)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.print",
					outcome: "denied",
					reason: "outside_scope",
				})
			)
			expect(pdf.render).not.toHaveBeenCalled()
		})

		it("refuses to print a revoked document before decrypting it", async () => {
			settings.DOCUMENT_PAYLOAD_KEY = undefined
			const { row } = printRow()
			arrange([{ ...row, status: "revoked" }])
			await expect(service.printForStaff(5, "staff-1", scope as never)).rejects.toBeInstanceOf(
				ConflictException
			)
		})
	})

	describe("public verification", () => {
		const TOKEN = "AbCdEfGhIjKlMnOpQrSt_-"
		function verificationRow(overrides: Record<string, unknown> = {}) {
			const payload = {
				holder: { name: "Juan Dela Cruz" },
				deceased: { causeOfDeath: "Cardiac arrest" },
				transport: { destination: "Cebu" },
			}
			return {
				documentType: "human-remains",
				documentNumber: "HRC-MNL-2026-000001",
				verificationToken: TOKEN,
				status: "valid",
				issuedAt: NOW,
				updatedAt: NOW,
				validUntil: null,
				payload: sealPayload(payload, key(), payloadAad("human-remains", "HRC-MNL-2026-000001")),
				issuingLocation: "BOQ Manila",
				...overrides,
			}
		}

		it("shows the status, the issuing Location and the masked name, and nothing else of the payload", async () => {
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query([verificationRow()]) as never)

			const result = await service.verify(TOKEN, NOW)

			expect(result).toMatchObject({
				documentType: "human-remains",
				documentTitle: "Human Remains Certificate",
				documentNumber: "HRC-MNL-2026-000001",
				holderName: maskName("Juan Dela Cruz"),
				issuingLocation: "BOQ Manila",
				status: "valid",
			})
			expect(result.holderName).not.toContain("Juan")
			const shown = JSON.stringify(result)
			for (const secret of ["Juan", "Dela Cruz", "Cardiac", "Cebu", "ciphertext"]) {
				expect(shown).not.toContain(secret)
			}
			expect(shown).not.toContain("payload")
		})

		it("shows a revoked document as revoked", async () => {
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(query([verificationRow({ status: "revoked" })]) as never)
			expect((await service.verify(TOKEN, NOW)).status).toBe("revoked")
		})

		it("shows an expired permit as expired, from its readable valid_until", async () => {
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(
					query([
						verificationRow({
							documentType: "biological-permit",
							documentNumber: "BPM-MNL-2026-000001",
							validUntil: "2026-11-18",
							payload: sealPayload(
								{ holder: { name: "Ana Reyes" } },
								key(),
								payloadAad("biological-permit", "BPM-MNL-2026-000001")
							),
						}),
					]) as never
				)
			const result = await service.verify(TOKEN, NOW)
			expect(result.status).toBe("expired")
			expect(result.holderName).toBe(maskName("Ana Reyes"))
		})

		it("still verifies documents issued before CRT-7, whose payload is not encrypted", async () => {
			settings.DOCUMENT_PAYLOAD_KEY = undefined
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(
					query([
						verificationRow({
							documentType: "haccp",
							documentNumber: "HCP-MNL-2026-000001",
							payload: { holder: { name: "Mercado Fresh Foods" } },
						}),
					]) as never
				)
			const result = await service.verify(TOKEN, NOW)
			expect(result.holderName).toBe(maskName("Mercado Fresh Foods"))
		})

		it("fails loudly, not with a wrong name, when the stored details no longer decrypt", async () => {
			jest
				.mocked(db.select)
				.mockReset()
				.mockReturnValueOnce(
					query([verificationRow({ documentNumber: "HRC-MNL-2026-000099" })]) as never
				)
			await expect(service.verify(TOKEN, NOW)).rejects.toBeInstanceOf(PayloadDecryptError)
		})
	})
})
