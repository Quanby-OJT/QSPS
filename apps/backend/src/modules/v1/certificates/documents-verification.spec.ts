import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { PdfService } from "@/common/pdf/pdf.service"

import type { BookingService } from "../bookings/bookings.service"
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

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv"
const CODE = TOKEN.slice(-8)

const issuedAt = new Date("2026-11-19T02:00:00.000Z")
const revokedAt = new Date("2026-11-20T05:30:00.000Z")

const makeRow = (overrides: Record<string, unknown> = {}) => ({
	documentType: "icv-record",
	documentNumber: "ICV-MNL-2026-000001",
	verificationToken: TOKEN,
	status: "valid",
	issuedAt,
	updatedAt: issuedAt,
	validUntil: null,
	payload: {
		holder: {
			name: "Juan Dela Cruz",
			birthDate: "1990-01-01",
			passportOrIdNumber: "P1234567",
		},
		batchNumber: "YF-24A",
	},
	issuingLocation: "Manila",
	...overrides,
})

/** db.select().from().innerJoin().where().limit() resolving to rows. */
function selectReturns(rows: unknown[]) {
	const where = jest.fn().mockReturnValue({ limit: () => Promise.resolve(rows) })
	jest.mocked(db.select).mockReturnValue({
		from: () => ({ innerJoin: () => ({ where }) }),
	} as never)
	return where
}

describe("DocumentService public verification (CRT-2)", () => {
	let service: DocumentService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn() }
		service = new DocumentService(
			auditService as unknown as AuditService,
			{} as BookingService,
			{} as PdfService
		)
	})

	it("shows type, number, masked holder, location, issue date and status for a valid token", async () => {
		selectReturns([makeRow()])

		await expect(service.verify(TOKEN)).resolves.toEqual({
			documentType: "icv-record",
			documentTitle: "International Certificate of Vaccination record",
			documentNumber: "ICV-MNL-2026-000001",
			holderName: "J*** D*** C***",
			issuingLocation: "Manila",
			issuedAt,
			status: "valid",
			validUntil: null,
			statusChangedAt: null,
		})
	})

	it("never returns the payload, the birth date or the passport/ID number", async () => {
		selectReturns([makeRow()])

		const result = await service.verify(TOKEN)
		const text = JSON.stringify(result)

		expect(result).not.toHaveProperty("payload")
		expect(text).not.toContain("P1234567")
		expect(text).not.toContain("1990-01-01")
		expect(text).not.toContain("Juan")
		expect(text).not.toContain(TOKEN)
	})

	it.each(["revoked", "superseded"])(
		"shows a %s document with the date its status changed",
		async status => {
			selectReturns([makeRow({ status, updatedAt: revokedAt })])

			await expect(service.verify(TOKEN)).resolves.toMatchObject({
				status,
				statusChangedAt: revokedAt,
			})
		}
	)

	describe("valid until (CRT-5)", () => {
		/** 13:00 on Thursday 19 November 2026 in Manila. */
		const DAY = new Date("2026-11-19T05:00:00.000Z")
		/** 00:00 on Friday 20 November 2026 in Manila: the first moment after the last valid day. */
		const NEXT_DAY = new Date("2026-11-19T16:00:00.000Z")

		it("shows the valid-until date, and stays valid before it", async () => {
			selectReturns([makeRow({ validUntil: "2026-11-28" })])

			await expect(service.verify(TOKEN, DAY)).resolves.toMatchObject({
				status: "valid",
				validUntil: "2026-11-28",
				statusChangedAt: null,
			})
		})

		it("is still valid on the valid-until day itself", async () => {
			selectReturns([makeRow({ validUntil: "2026-11-19" })])

			await expect(service.verify(TOKEN, DAY)).resolves.toMatchObject({ status: "valid" })
		})

		it("is expired the day after, keeping its valid-until date", async () => {
			selectReturns([makeRow({ validUntil: "2026-11-19" })])

			await expect(service.verify(TOKEN, NEXT_DAY)).resolves.toMatchObject({
				status: "expired",
				validUntil: "2026-11-19",
				statusChangedAt: null,
			})
		})

		it("never expires without a valid-until date", async () => {
			selectReturns([makeRow({ validUntil: null })])

			await expect(
				service.verify(TOKEN, new Date("2099-01-01T00:00:00.000Z"))
			).resolves.toMatchObject({ status: "valid", validUntil: null })
		})

		it.each(["revoked", "superseded"])(
			"keeps a %s document %s after its valid-until date has passed",
			async status => {
				selectReturns([makeRow({ status, updatedAt: revokedAt, validUntil: "2026-11-19" })])

				await expect(service.verify(TOKEN, NEXT_DAY)).resolves.toMatchObject({
					status,
					statusChangedAt: revokedAt,
				})
			}
		)

		it("checks expiry on the manual-entry lookup too", async () => {
			selectReturns([makeRow({ validUntil: "2026-11-19" })])

			await expect(
				service.verifyByNumber({ documentNumber: "ICV-MNL-2026-000001", code: CODE }, NEXT_DAY)
			).resolves.toMatchObject({ status: "expired", validUntil: "2026-11-19" })
		})

		it("verifies a sanitary permit and a ship sanitation certificate, showing no findings or address", async () => {
			selectReturns([
				makeRow({
					documentType: "sanitary-permit",
					documentNumber: "SPM-MNL-2026-000001",
					validUntil: "2027-11-18",
					payload: { holder: { name: "Mercado Fresh Foods" }, address: "12 Rizal St" },
				}),
			])
			const permit = await service.verify(TOKEN, DAY)
			expect(permit).toMatchObject({
				documentType: "sanitary-permit",
				documentTitle: "Sanitary Permit",
				holderName: "M*** F*** F***",
				status: "valid",
				validUntil: "2027-11-18",
			})
			expect(JSON.stringify(permit)).not.toContain("Rizal")

			selectReturns([
				makeRow({
					documentType: "ship-sanitation",
					documentNumber: "SSC-MNL-2026-000001",
					validUntil: "2026-11-19",
					payload: { holder: { name: "MV Pacific Star" }, findings: "No deficiencies" },
				}),
			])
			const certificate = await service.verify(TOKEN, NEXT_DAY)
			expect(certificate).toMatchObject({
				documentType: "ship-sanitation",
				documentTitle: "Ship Sanitation Certificate",
				status: "expired",
			})
			expect(JSON.stringify(certificate)).not.toContain("No deficiencies")
		})
	})

	it("answers 404 for an unknown token", async () => {
		selectReturns([])

		await expect(service.verify(TOKEN)).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "No record found",
		})
	})

	it.each(["", "short", `${TOKEN}x`, "AbCdEfGhIjKlMnOpQrSt+/"])(
		"answers 404 for the malformed token %j without querying",
		async token => {
			await expect(service.verify(token)).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(db.select).not.toHaveBeenCalled()
		}
	)

	it("is not audited: the lookup is public and writes nothing", async () => {
		selectReturns([makeRow()])
		await service.verify(TOKEN)
		expect(auditService.record).not.toHaveBeenCalled()
	})

	describe("manual entry", () => {
		it("finds the document by its number and the code under the QR code", async () => {
			selectReturns([makeRow()])

			await expect(
				service.verifyByNumber({ documentNumber: "ICV-MNL-2026-000001", code: CODE })
			).resolves.toMatchObject({ documentNumber: "ICV-MNL-2026-000001", status: "valid" })
		})

		it("answers 404 when the code does not match, even though the number exists", async () => {
			selectReturns([makeRow()])

			await expect(
				service.verifyByNumber({ documentNumber: "ICV-MNL-2026-000001", code: "zzzzzzzz" })
			).rejects.toMatchObject({ code: "NOT_FOUND", message: "No record found" })
		})

		it("answers 404 for a malformed code without querying", async () => {
			await expect(
				service.verifyByNumber({ documentNumber: "ICV-MNL-2026-000001", code: "abc" })
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(db.select).not.toHaveBeenCalled()
		})
	})
})
