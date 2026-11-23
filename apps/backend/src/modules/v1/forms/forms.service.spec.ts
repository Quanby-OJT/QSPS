import { formFields, formTemplates } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { ResolvedScope } from "@/common/scope/scope-match"

import { FormsService } from "./forms.service"

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

jest.mock("@/common/database/database.client", () => ({
	db: {
		select: jest.fn(),
		insert: jest.fn(),
		update: jest.fn(),
		delete: jest.fn(),
		transaction: jest.fn(),
	},
}))

const NOW = new Date("2026-11-23T02:00:00.000Z")
const SERVICE = { id: 7, serviceCategoryId: 3 }

function template(overrides: Record<string, unknown> = {}) {
	return {
		id: 11,
		serviceId: 7,
		version: 1,
		status: "draft",
		isActive: true,
		publishedAt: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	}
}

function fieldRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 100,
		formTemplateId: 11,
		type: "text",
		label: "Full name on passport",
		required: true,
		options: null,
		position: 0,
		...overrides,
	}
}

const nameField = {
	type: "text",
	label: "Full name on passport",
	required: true,
	options: null,
} as const
const travelField = {
	type: "single_choice",
	label: "Purpose of travel",
	required: false,
	options: ["Work", "Leisure"] as string[],
} as const

/**
 * A stand-in database. Each `select` resolves to the next entry in `selects`
 * however the query ends (limit, for, orderBy, or awaited directly). Inserts
 * and updates that end in `returning()` take the next entry of their queue.
 * Every write is recorded so tests can check what changed.
 */
function fakeDatabase(options: {
	selects?: unknown[][]
	inserts?: unknown[][]
	updates?: unknown[][]
}) {
	const selects = [...(options.selects ?? [])]
	const insertReturns = [...(options.inserts ?? [])]
	const updateReturns = [...(options.updates ?? [])]
	const inserted: { table: unknown; values: unknown }[] = []
	const updated: { table: unknown; values: Record<string, unknown> }[] = []
	const deleted: unknown[] = []

	// Lets a query builder be awaited directly, like Drizzle's.
	const thenOf =
		<T>(value: () => T) =>
		(resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
			Promise.resolve(value()).then(resolve, reject)

	const select = () => {
		const rows = selects.shift() ?? []
		const chain: Record<string, unknown> = {
			then: thenOf(() => rows),
			from: () => chain,
			innerJoin: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => Promise.resolve(rows),
			for: () => Promise.resolve(rows),
		}
		return chain
	}
	const insert = (table: unknown) => ({
		values: (values: unknown) => {
			inserted.push({ table, values })
			return {
				then: thenOf(() => undefined),
				returning: () => Promise.resolve(insertReturns.shift() ?? []),
			}
		},
	})
	const update = (table: unknown) => ({
		set: (values: Record<string, unknown>) => {
			updated.push({ table, values })
			return {
				where: () => ({
					then: thenOf(() => undefined),
					returning: () => Promise.resolve(updateReturns.shift() ?? []),
				}),
			}
		},
	})
	const remove = (table: unknown) => ({
		where: () => {
			deleted.push(table)
			return Promise.resolve()
		},
	})

	const handle = { select, insert, update, delete: remove }
	const mocked = db as unknown as Record<
		"select" | "insert" | "update" | "delete" | "transaction",
		jest.Mock
	>
	mocked.select.mockImplementation(select)
	mocked.insert.mockImplementation(insert)
	mocked.update.mockImplementation(update)
	mocked.delete.mockImplementation(remove)
	mocked.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(handle))

	return { inserted, updated, deleted }
}

/** The reads `withFields` makes at the end of most methods. */
function withFieldsReads(fields: unknown[], submissions = 0): unknown[][] {
	return [fields, [{ total: fields.length }], [{ total: submissions }]]
}

describe("FormsService", () => {
	let audit: { record: jest.Mock }
	let service: FormsService

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		service = new FormsService(audit as unknown as AuditService)
	})

	const actions = () => audit.record.mock.calls.map(([entry]) => entry.action)

	describe("createDraft", () => {
		it("starts version 1, empty, when the service has no questionnaire", async () => {
			const database = fakeDatabase({
				selects: [[SERVICE], [], [], [{ version: null }], ...withFieldsReads([])],
				inserts: [[template()]],
			})

			const draft = await service.createDraft(7, "admin-1")

			expect(database.inserted[0]).toEqual({
				table: formTemplates,
				values: { serviceId: 7, version: 1, status: "draft", isActive: true },
			})
			expect(draft).toMatchObject({ id: 11, version: 1, status: "draft", fields: [] })
			expect(actions()).toEqual(["form_template.version.create"])
		})

		it("returns the existing draft instead of making a second one", async () => {
			const database = fakeDatabase({
				selects: [[SERVICE], [template({ version: 2 })], ...withFieldsReads([fieldRow()])],
			})

			const draft = await service.createDraft(7, "admin-1")

			expect(draft).toMatchObject({ version: 2, status: "draft" })
			expect(database.inserted).toEqual([])
		})
	})

	describe("saveFields", () => {
		it("replaces a draft's questions in the order given and audits old and new", async () => {
			const database = fakeDatabase({
				selects: [
					[template()],
					[SERVICE],
					[fieldRow()],
					...withFieldsReads([fieldRow(), fieldRow({ id: 101, ...travelField, position: 1 })]),
				],
				updates: [[template()]],
			})

			const saved = await service.saveFields(11, [nameField, travelField], "admin-1")

			expect(database.deleted).toEqual([formFields])
			expect(database.inserted[0]).toEqual({
				table: formFields,
				values: [
					{ formTemplateId: 11, ...nameField, position: 0 },
					{ formTemplateId: 11, ...travelField, position: 1 },
				],
			})
			expect(saved.fields).toHaveLength(2)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "form_template.fields.update",
					oldValue: {
						fields: [
							{ type: "text", label: "Full name on passport", required: true, options: null },
						],
					},
					newValue: { fields: [nameField, travelField] },
				}),
				expect.anything()
			)
		})

		it("creates the next version as a draft when a published version is edited, leaving it untouched", async () => {
			const published = template({ status: "published", publishedAt: NOW })
			const database = fakeDatabase({
				selects: [
					[published],
					[SERVICE],
					[],
					[{ version: 1 }],
					...withFieldsReads([fieldRow({ formTemplateId: 12 })]),
				],
				inserts: [[template({ id: 12, version: 2 })]],
			})

			const saved = await service.saveFields(11, [nameField], "admin-1")

			expect(saved).toMatchObject({ id: 12, version: 2, status: "draft" })
			expect(database.inserted[0]).toEqual({
				table: formTemplates,
				values: { serviceId: 7, version: 2, status: "draft", isActive: true },
			})
			// The published version keeps its questions, so its submissions still display.
			expect(database.deleted).toEqual([])
			expect(database.updated).toEqual([])
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "form_template.version.create",
					oldValue: { fromTemplateId: 11, fromVersion: 1 },
				}),
				expect.anything()
			)
		})

		it("refuses to edit a published version while a draft already exists", async () => {
			fakeDatabase({ selects: [[template({ status: "published" })], [SERVICE], [{ version: 2 }]] })

			await expect(service.saveFields(11, [nameField], "admin-1")).rejects.toMatchObject({
				code: "CONFLICT",
			})
		})

		it("refuses to edit a retired version", async () => {
			fakeDatabase({ selects: [[template({ status: "retired" })], [SERVICE]] })

			await expect(service.saveFields(11, [nameField], "admin-1")).rejects.toMatchObject({
				code: "CONFLICT",
			})
		})
	})

	describe("publish", () => {
		it("makes the draft active and retires the previous version, keeping it", async () => {
			const database = fakeDatabase({
				selects: [
					[template({ id: 12, version: 2 })],
					[SERVICE],
					[fieldRow()],
					...withFieldsReads([fieldRow()]),
				],
				updates: [
					[{ id: 11, version: 1 }],
					[template({ id: 12, version: 2, status: "published", publishedAt: NOW })],
				],
			})

			const published = await service.publish(12, "admin-1")

			expect(database.updated[0]?.values).toMatchObject({ status: "retired" })
			expect(database.updated[1]?.values).toMatchObject({ status: "published", isActive: true })
			expect(database.deleted).toEqual([])
			expect(published).toMatchObject({ id: 12, status: "published" })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "form_template.publish",
					oldValue: { status: "draft", retiredVersions: [1] },
				}),
				expect.anything()
			)
		})

		it("refuses a draft with no questions", async () => {
			fakeDatabase({ selects: [[template()], [SERVICE], []] })

			await expect(service.publish(11, "admin-1")).rejects.toMatchObject({ code: "BAD_REQUEST" })
		})

		it("refuses to publish a version that is not a draft", async () => {
			fakeDatabase({ selects: [[template({ status: "published" })], [SERVICE]] })

			await expect(service.publish(11, "admin-1")).rejects.toMatchObject({ code: "CONFLICT" })
		})
	})

	describe("delete", () => {
		it("removes a version nobody has answered", async () => {
			const database = fakeDatabase({
				selects: [[template()], [SERVICE], [{ total: 0 }], [fieldRow()]],
			})

			await expect(service.delete(11, "admin-1")).resolves.toEqual({ deleted: true })
			expect(database.deleted).toEqual([formTemplates])
			expect(actions()).toEqual(["form_template.delete"])
		})

		it("refuses a version with submissions and offers to disable it instead", async () => {
			const database = fakeDatabase({
				selects: [[template({ status: "published" })], [SERVICE], [{ total: 3 }]],
			})

			const error = await service.delete(11, "admin-1").catch((caught: unknown) => caught)

			expect(error).toMatchObject({
				code: "CONFLICT",
				options: { data: { submissionCount: 3, canDisable: true } },
			})
			expect(database.deleted).toEqual([])
			expect(audit.record).not.toHaveBeenCalled()
		})
	})

	describe("setActive", () => {
		it("disables a published version and audits the change", async () => {
			const database = fakeDatabase({
				selects: [[template({ status: "published" })], [SERVICE], [{ total: 2 }], [{ total: 0 }]],
				updates: [[template({ status: "published", isActive: false })]],
			})

			const summary = await service.setActive(11, false, "admin-1")

			expect(database.updated[0]?.values).toMatchObject({ isActive: false })
			expect(summary.isActive).toBe(false)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "form_template.disable",
					oldValue: { isActive: true },
					newValue: { isActive: false },
				}),
				expect.anything()
			)
		})

		it("has nothing to disable on a draft", async () => {
			fakeDatabase({ selects: [[template()], [SERVICE]] })

			await expect(service.setActive(11, false, "admin-1")).rejects.toMatchObject({
				code: "CONFLICT",
			})
		})
	})

	describe("Scope (ADM-2)", () => {
		const otherCategory: ResolvedScope = {
			nationwide: false,
			entries: [{ serviceCategoryId: 99, locationId: null }],
		}

		it("answers 404 and audits a denial for a template outside the caller's Service Categories", async () => {
			const database = fakeDatabase({ selects: [[template()], [SERVICE]] })

			await expect(
				service.saveFields(11, [nameField], "admin-2", otherCategory)
			).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(database.deleted).toEqual([])
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					outcome: "denied",
					actorId: "admin-2",
					targetType: "form_template",
				})
			)
		})
	})

	describe("listServices", () => {
		it("shows each service's published and draft versions", async () => {
			fakeDatabase({
				selects: [
					[
						{ id: 7, code: "YF", name: "Yellow fever vaccination" },
						{ id: 8, code: "SP", name: "Sanitary permit" },
					],
					[
						{ id: 11, serviceId: 7, version: 1, status: "published", isActive: false },
						{ id: 12, serviceId: 7, version: 2, status: "draft", isActive: true },
					],
				],
			})

			await expect(service.listServices()).resolves.toEqual([
				{
					serviceId: 7,
					serviceCode: "YF",
					serviceName: "Yellow fever vaccination",
					published: { templateId: 11, version: 1, isActive: false },
					draft: { templateId: 12, version: 2 },
				},
				{
					serviceId: 8,
					serviceCode: "SP",
					serviceName: "Sanitary permit",
					published: null,
					draft: null,
				},
			])
		})
	})
})
