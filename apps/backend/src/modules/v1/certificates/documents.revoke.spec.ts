import { documents, documentSequences } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import type { PdfService } from "@/common/pdf/pdf.service"

import type { BookingService } from "../bookings/bookings.service"
import { DocumentService } from "./documents.service"

// BookingService reads PolicyService, which loads @repo/contracts (ESM-only). Not tested here.
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

/** The plain `db` answers its selects in order; its transaction runs on `tx`. */
function dbAnswers(selects: unknown[][], tx?: unknown) {
	const queue = [...selects]
	;(db.select as jest.Mock).mockImplementation(() => query(queue.shift() ?? []))
	;(db.transaction as jest.Mock).mockImplementation(async (run: (t: unknown) => unknown) => run(tx))
}

const icvDocument = {
	id: 8,
	bookingItemId: 44,
	documentType: "icv-record",
	documentNumber: "ICV-MNL-2026-000007",
	source: "qsps",
	issuingLocationId: 2,
	serviceCategoryId: 1,
}
const legacyDocument = {
	...icvDocument,
	id: 12,
	bookingItemId: null,
	source: "legacy",
	serviceCategoryId: null,
}
const reissueContext = {
	serviceDocumentType: "icv-record",
	serviceName: "Yellow fever vaccination",
	locationCode: "MNL",
	locationName: "BOQ Manila",
	bookingId: 31,
	holderName: "Test Three",
	holderBirthDate: "2003-07-12",
	holderGender: "Male",
	holderNationality: "Filipino",
}
const details = {
	batchNumber: "YF-25B",
	vaccinatorName: "Dr. Juan Reyes",
	validFrom: "2026-11-24",
	validUntil: null,
	passportOrIdNumber: null,
}

function summary(overrides: Record<string, unknown> = {}) {
	return {
		id: 8,
		documentType: "icv-record",
		documentNumber: "ICV-MNL-2026-000007",
		status: "valid",
		issuedAt: new Date("2026-11-24T00:00:00.000Z"),
		validUntil: null,
		serviceName: "Yellow fever vaccination",
		locationName: "BOQ Manila",
		referenceNumber: "QSPS-261124-ABWF82",
		...overrides,
	}
}

/** Scoped to another Location: the documents above are outside it. */
const otherLocation = {
	nationwide: false,
	entries: [{ serviceCategoryId: null, locationId: 99 }],
} as never

describe("DocumentService revoke and reissue (CRT-8)", () => {
	let audit: { record: jest.Mock }
	let service: DocumentService

	beforeEach(() => {
		jest.clearAllMocks()
		jest.spyOn(NotificationService, "enqueue").mockResolvedValue(undefined)
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		service = new DocumentService(
			audit as unknown as AuditService,
			{} as unknown as BookingService,
			{} as unknown as PdfService
		)
	})

	describe("revoke", () => {
		it("revokes a valid document with the reason, audits it and tells the client, in one transaction", async () => {
			const { tx, locks, updated } = fakeTransaction([[{ status: "valid" }], [{ bookingId: 31 }]])
			dbAnswers([[icvDocument], [summary({ status: "revoked" })]], tx)

			const result = await service.revoke(8, "Wrong batch number", "admin-1")

			expect(locks).toEqual(["update"])
			expect(updated).toEqual([
				{
					table: documents,
					values: expect.objectContaining({
						status: "revoked",
						statusReason: "Wrong batch number",
						statusChangedBy: "admin-1",
					}),
				},
			])
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.revoke",
					actorId: "admin-1",
					targetId: "8",
					oldValue: expect.objectContaining({ status: "valid" }),
					newValue: expect.objectContaining({ status: "revoked", reason: "Wrong batch number" }),
				}),
				tx
			)
			expect(NotificationService.enqueue).toHaveBeenCalledWith(
				tx,
				31,
				"document_revoked",
				"document:8:revoked"
			)
			expect(result.status).toBe("revoked")
		})

		it("refuses a document that is no longer valid, and changes nothing", async () => {
			const { tx, updated } = fakeTransaction([[{ status: "superseded" }]])
			dbAnswers([[icvDocument]], tx)

			await expect(service.revoke(8, "Again", "admin-1")).rejects.toMatchObject({
				code: "CONFLICT",
			})
			expect(updated).toEqual([])
			expect(NotificationService.enqueue).not.toHaveBeenCalled()
		})

		it("answers 404 outside the caller's Scope and audits the denial", async () => {
			dbAnswers([[icvDocument]])

			await expect(service.revoke(8, "x", "officer-1", otherLocation)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.revoke",
					outcome: "denied",
					reason: "outside_scope",
					targetId: "8",
				})
			)
			expect(db.transaction).not.toHaveBeenCalled()
		})

		it("answers the same 404 for a missing document, without an audit", async () => {
			dbAnswers([[]])

			await expect(service.revoke(404, "x", "admin-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("revokes a legacy document, which has no Booking to notify", async () => {
			const { tx } = fakeTransaction([[{ status: "valid" }]])
			dbAnswers(
				[
					[legacyDocument],
					[summary({ id: 12, status: "revoked", serviceName: null, referenceNumber: null })],
				],
				tx
			)

			const result = await service.revoke(12, "Fraudulent", "admin-1")

			expect(NotificationService.enqueue).not.toHaveBeenCalled()
			expect(result.referenceNumber).toBe("")
			expect(result.serviceName).not.toBe("")
		})

		it("needs a signed-in user", async () => {
			await expect(service.revoke(8, "x", null)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		})
	})

	describe("reissue", () => {
		it("supersedes the old document first, issues a new number and token, and points the old one to it", async () => {
			const { tx, inserted, updated } = fakeTransaction(
				[[{ status: "valid" }], [reissueContext], [{ id: 1, nextNumber: 8 }]],
				[[{ id: 9 }]]
			)
			dbAnswers([[icvDocument], [summary({ id: 9, documentNumber: "ICV-MNL-2026-000008" })]], tx)

			const result = await service.reissue(
				{ documentId: 8, reason: "Wrong batch number", details, exemption: null },
				"admin-1"
			)

			// Superseded before the new row exists: one valid document per item.
			expect(updated[0]).toEqual({
				table: documents,
				values: expect.objectContaining({
					status: "superseded",
					statusReason: "Wrong batch number",
					statusChangedBy: "admin-1",
				}),
			})
			expect(inserted[0]?.table).toBe(documentSequences)
			expect(inserted[1]).toEqual({
				table: documents,
				values: expect.objectContaining({
					bookingItemId: 44,
					documentType: "icv-record",
					documentNumber: expect.stringMatching(/^ICV-MNL-\d{4}-000008$/),
					issuingLocationId: 2,
					issuedBy: "admin-1",
					status: "valid",
					source: "qsps",
					verificationToken: expect.any(String),
				}),
			})
			expect(updated[2]).toEqual({ table: documents, values: { supersededBy: 9 } })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "document.reissue",
					targetId: "8",
					newValue: expect.objectContaining({
						status: "superseded",
						reason: "Wrong batch number",
						supersededBy: 9,
					}),
				}),
				tx
			)
			expect(NotificationService.enqueue).toHaveBeenCalledWith(
				tx,
				31,
				"document_reissued",
				"document:8:reissued"
			)
			expect(result.id).toBe(9)
		})

		it("needs the exemption details to reissue a Medical Exemption Certificate", async () => {
			const { tx, updated } = fakeTransaction([[{ status: "valid" }], [reissueContext]])
			dbAnswers([[{ ...icvDocument, documentType: "medical-exemption" }]], tx)

			await expect(
				service.reissue({ documentId: 8, reason: "Fix", details, exemption: null }, "admin-1")
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(updated).toEqual([])
		})

		it("does not reissue a legacy document yet", async () => {
			dbAnswers([[legacyDocument]])

			await expect(
				service.reissue({ documentId: 12, reason: "Fix", details, exemption: null }, "admin-1")
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(db.transaction).not.toHaveBeenCalled()
		})

		it("answers 404 outside the caller's Scope and audits the denial", async () => {
			dbAnswers([[icvDocument]])

			await expect(
				service.reissue(
					{ documentId: 8, reason: "Fix", details, exemption: null },
					"officer-1",
					otherLocation
				)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "document.reissue", outcome: "denied" })
			)
		})
	})
})
