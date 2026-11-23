import { Logger } from "@nestjs/common"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { FileStorage } from "@/common/storage/file-storage"

import type { BookingService } from "../bookings/bookings.service"
import type { DocumentService } from "../certificates/documents.service"
import { ProcessingService } from "./processing.service"

// Same isolation as processing.service.spec.ts.
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

const MANILA_SCOPE = {
	nationwide: false as const,
	entries: [{ serviceCategoryId: null, locationId: 2 }],
}

const KEY = "form-uploads/client-1/0b6f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b.pdf"
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])

/** The item row the Scope check reads: at Manila (location 2). */
const itemAtManila = [{ id: 44, locationId: 2, serviceCategoryId: 1 }]
const submission = [
	{
		formTemplateId: 3,
		answers: { "13": "Juan", "20": KEY },
		referenceNumber: "QSPS-261123-CZN7GB",
	},
]

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

function selects(...rowSets: unknown[][]) {
	const select = jest.mocked(db.select)
	select.mockReset()
	for (const rows of rowSets) select.mockReturnValueOnce(query(rows) as never)
}

describe("ProcessingService.answerFile (FRM-2c)", () => {
	let auditService: { record: jest.Mock }
	let storage: { read: jest.Mock }
	let service: ProcessingService
	let warnings: jest.SpyInstance

	beforeEach(() => {
		jest.clearAllMocks()
		warnings = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		storage = { read: jest.fn().mockResolvedValue(PDF) }
		service = new ProcessingService(
			{} as BookingService,
			auditService as unknown as AuditService,
			{} as DocumentService,
			storage as unknown as FileStorage
		)
	})

	it("returns the stored file with its real type and audits the download", async () => {
		selects(itemAtManila, submission, [{ type: "file" }])

		const file = await service.answerFile(44, 20, "officer-1", MANILA_SCOPE)

		expect(file).toEqual({
			fileName: "QSPS-261123-CZN7GB-question-20.pdf",
			contentType: "application/pdf",
			body: PDF,
		})
		expect(storage.read).toHaveBeenCalledWith(KEY)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "form_upload.read",
				actorId: "officer-1",
				targetType: "booking_item",
				targetId: "44",
				newValue: { fieldId: 20, fileKey: KEY },
			})
		)
	})

	it("answers 404 and audits a denial for an item outside the caller's Scope", async () => {
		selects([{ id: 44, locationId: 9, serviceCategoryId: 1 }])

		await expect(service.answerFile(44, 20, "officer-1", MANILA_SCOPE)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
		expect(storage.read).not.toHaveBeenCalled()
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "form_upload.read",
				outcome: "denied",
				reason: "outside_scope",
			})
		)
	})

	it("answers 404 for a question that is not a file question", async () => {
		selects(itemAtManila, submission, [{ type: "text" }])

		await expect(service.answerFile(44, 13, "officer-1", MANILA_SCOPE)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
		expect(storage.read).not.toHaveBeenCalled()
	})

	it("answers 404 for a question from another form version", async () => {
		selects(itemAtManila, submission, [])

		await expect(service.answerFile(44, 20, "officer-1", MANILA_SCOPE)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
		expect(storage.read).not.toHaveBeenCalled()
	})

	it("answers 404 when the item has no submission", async () => {
		selects(itemAtManila, [])

		await expect(service.answerFile(44, 20, "officer-1", MANILA_SCOPE)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
	})

	it("never serves a key that is not a confirmed upload", async () => {
		const pending = "form-uploads/pending/client-1/0b6f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b.pdf"
		selects(itemAtManila, [{ ...submission[0], answers: { "20": pending } }], [{ type: "file" }])

		await expect(service.answerFile(44, 20, "officer-1", MANILA_SCOPE)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
		expect(storage.read).not.toHaveBeenCalled()
	})

	it("answers 404 and warns when the file is gone from storage", async () => {
		selects(itemAtManila, submission, [{ type: "file" }])
		storage.read.mockResolvedValue(null)

		await expect(service.answerFile(44, 20, "officer-1", MANILA_SCOPE)).rejects.toMatchObject({
			code: "NOT_FOUND",
		})
		expect(warnings).toHaveBeenCalledWith(
			expect.objectContaining({ event: "processing.answer_file.missing", bookingItemId: 44 })
		)
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("refuses a request with no signed-in user", async () => {
		await expect(service.answerFile(44, 20, null, MANILA_SCOPE)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		})
	})
})
