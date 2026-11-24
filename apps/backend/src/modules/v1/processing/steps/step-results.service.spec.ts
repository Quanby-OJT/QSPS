import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { PdfService } from "@/common/pdf/pdf.service"

import type { ProcessingService } from "../processing.service"
import { fieldsByTemplate, publishedStepForms } from "./item-steps"
import { StepResultsService } from "./step-results.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			public readonly options: { message: string; data?: unknown }
		) {
			super(options.message)
		}
	},
}))

// @repo/contracts' index loads oRPC, which Jest cannot load; the service only
// needs checkFormAnswers from it (same approach as form-submissions.service.spec).
jest.mock("@repo/contracts", () =>
	jest.requireActual("../../../../../../../packages/contracts/src/modules/v1/forms/form-answers")
)

// Passed in by hand below; mocked so the bookings and certificates modules are not loaded.
jest.mock("../processing.service", () => ({ ProcessingService: jest.fn() }))

jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn(), transaction: jest.fn() },
}))

jest.mock("./item-steps", () => ({
	...jest.requireActual("./item-steps"),
	fieldsByTemplate: jest.fn(),
	publishedStepForms: jest.fn(),
}))

/** A query that resolves to `rows` however it is chained. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		innerJoin: () => chain,
		leftJoin: () => chain,
		where: () => chain,
		orderBy: () => chain,
		for: () => Promise.resolve(rows),
		limit: () => Promise.resolve(rows),
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

const NOW = new Date("2026-11-24T02:00:00.000Z")
const SCOPE = { nationwide: false, entries: [{ serviceCategoryId: 1, locationId: 2 }] }
const resultField = {
	id: 61,
	type: "text" as const,
	label: "Result",
	required: true,
	options: null,
	position: 0,
}

describe("StepResultsService (PRC-4)", () => {
	let service: StepResultsService
	let processing: { requireItemInScope: jest.Mock; loadItem: jest.Mock }
	let audit: { record: jest.Mock }
	let pdf: { render: jest.Mock }
	let values: jest.Mock
	let tx: { select: jest.Mock; insert: jest.Mock }

	/** The transaction's selects answer these row sets in order. */
	function txSelects(...rowSets: unknown[][]) {
		for (const rows of rowSets) tx.select.mockReturnValueOnce(query(rows))
	}

	beforeEach(() => {
		jest.clearAllMocks()
		processing = {
			requireItemInScope: jest.fn().mockResolvedValue(undefined),
			loadItem: jest.fn().mockResolvedValue({ bookingItemId: 44, steps: [] }),
		}
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		pdf = {
			render: jest.fn(async (_info: unknown, draw: (doc: unknown) => void) => {
				const doc: Record<string, unknown> = {
					page: { margins: { left: 50, right: 50 }, width: 595 },
					y: 100,
				}
				for (const method of [
					"font",
					"fontSize",
					"fillColor",
					"text",
					"moveDown",
					"moveTo",
					"lineTo",
					"lineWidth",
					"strokeColor",
					"stroke",
				]) {
					doc[method] = jest.fn(() => doc)
				}
				draw(doc)
				return Buffer.from("%PDF-1.3")
			}),
		}
		values = jest.fn(() => ({ returning: () => Promise.resolve([{ id: 12 }]) }))
		tx = { select: jest.fn(), insert: jest.fn(() => ({ values })) }
		jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
		jest
			.mocked(publishedStepForms)
			.mockResolvedValue(new Map([[3, { formTemplateId: 50, version: 1 }]]))
		jest.mocked(fieldsByTemplate).mockResolvedValue(new Map([[50, [resultField]]]))
		service = new StepResultsService(
			processing as unknown as ProcessingService,
			audit as unknown as AuditService,
			pdf as unknown as PdfService
		)
	})

	const input = {
		bookingItemId: 44,
		stepId: 3,
		formTemplateId: 50,
		answers: { "61": " Negative " },
	}

	describe("record", () => {
		it("records the first result as version 1, audited, after the Scope and station check", async () => {
			txSelects([{ status: "in_assessment", serviceId: 1 }], [{ id: 3, name: "Laboratory" }], [])

			const item = await service.record(input, "staff-1", SCOPE as never, NOW)

			expect(processing.requireItemInScope).toHaveBeenCalledWith(
				44,
				"staff-1",
				"step_result.record",
				SCOPE
			)
			expect(values).toHaveBeenCalledWith({
				bookingItemId: 44,
				serviceStepId: 3,
				formTemplateId: 50,
				version: 1,
				answers: { "61": "Negative" },
				recordedBy: "staff-1",
				createdAt: NOW,
			})
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "processing",
					action: "step_result.record",
					actorId: "staff-1",
					targetType: "booking_item",
					targetId: "44",
					oldValue: null,
					newValue: expect.objectContaining({ stepId: 3, stepName: "Laboratory", version: 1 }),
				}),
				tx
			)
			expect(item).toEqual({ bookingItemId: 44, steps: [] })
		})

		it("keeps the earlier version and audits a correction with the old and new answers", async () => {
			txSelects(
				[{ status: "in_assessment", serviceId: 1 }],
				[{ id: 3, name: "Laboratory" }],
				[{ version: 2, formTemplateId: 50, answers: { "61": "Positive" } }]
			)

			await service.record(input, "staff-1", SCOPE as never, NOW)

			expect(values).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }))
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "step_result.correct",
					oldValue: { stepId: 3, version: 2, formTemplateId: 50, answers: { "61": "Positive" } },
					newValue: expect.objectContaining({ version: 3, answers: { "61": "Negative" } }),
				}),
				tx
			)
		})

		it("writes nothing when the item is outside the caller's Scope or station", async () => {
			processing.requireItemInScope.mockRejectedValue(
				Object.assign(new Error("Booking item not found at your location"), { code: "NOT_FOUND" })
			)

			await expect(service.record(input, "staff-1", SCOPE as never, NOW)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(db.transaction).not.toHaveBeenCalled()
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("refuses a result unless the item is in assessment", async () => {
			txSelects([{ status: "cleared", serviceId: 1 }])
			await expect(service.record(input, "staff-1", SCOPE as never, NOW)).rejects.toMatchObject({
				code: "CONFLICT",
			})
			expect(values).not.toHaveBeenCalled()
		})

		it("answers 404 for a step of another Service or a disabled step", async () => {
			txSelects([{ status: "in_assessment", serviceId: 1 }], [])
			await expect(service.record(input, "staff-1", SCOPE as never, NOW)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(values).not.toHaveBeenCalled()
		})

		it("asks staff to fill the form again when it changed", async () => {
			txSelects([{ status: "in_assessment", serviceId: 1 }], [{ id: 3, name: "Laboratory" }])
			await expect(
				service.record({ ...input, formTemplateId: 49 }, "staff-1", SCOPE as never, NOW)
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				options: expect.objectContaining({ data: { formChanged: true } }),
			})
			expect(values).not.toHaveBeenCalled()
		})

		it("refuses missing required answers with the question to fix", async () => {
			txSelects([{ status: "in_assessment", serviceId: 1 }], [{ id: 3, name: "Laboratory" }])
			await expect(
				service.record({ ...input, answers: {} }, "staff-1", SCOPE as never, NOW)
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				options: expect.objectContaining({
					data: { fieldErrors: { "61": "This question is required" } },
				}),
			})
			expect(values).not.toHaveBeenCalled()
		})
	})

	describe("resultPdf", () => {
		const itemRow = {
			referenceNumber: "QSPS-261124-AB12CD",
			clientName: "Alex Johnson",
			serviceName: "Physical examination",
			locationName: "Manila",
			serviceId: 1,
		}

		it("prints the current result, readable by question, after the Scope check", async () => {
			jest
				.mocked(db.select)
				.mockReturnValueOnce(query([itemRow]) as never)
				.mockReturnValueOnce(query([{ id: 3, name: "Physician evaluation" }]) as never)
				.mockReturnValueOnce(
					query([
						{
							version: 2,
							formTemplateId: 50,
							answers: { "61": "Fit" },
							recordedByName: "Alex Johnson",
							createdAt: NOW,
						},
					]) as never
				)
				.mockReturnValueOnce(query([{ version: 1 }]) as never)

			const file = await service.resultPdf(44, 3, null, "staff-1", SCOPE as never)

			expect(processing.requireItemInScope).toHaveBeenCalledWith(
				44,
				"staff-1",
				"step_result.print",
				SCOPE,
				{ requireStation: false }
			)
			expect(file).toEqual({
				fileName: "QSPS-261124-AB12CD-physician-evaluation-v2-2026-11-24.pdf",
				pdf: Buffer.from("%PDF-1.3"),
			})
			expect(pdf.render).toHaveBeenCalledWith(
				{ title: "Physician evaluation result QSPS-261124-AB12CD" },
				expect.any(Function)
			)
		})

		it("answers 404 when no result is recorded for the step", async () => {
			jest
				.mocked(db.select)
				.mockReturnValueOnce(query([itemRow]) as never)
				.mockReturnValueOnce(query([{ id: 3, name: "Laboratory" }]) as never)
				.mockReturnValueOnce(query([]) as never)

			await expect(service.resultPdf(44, 3, null, "staff-1", SCOPE as never)).rejects.toMatchObject(
				{ code: "NOT_FOUND" }
			)
			expect(pdf.render).not.toHaveBeenCalled()
		})
	})
})
