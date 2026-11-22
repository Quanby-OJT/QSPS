import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { PolicyDocumentService } from "./policy-documents.service"

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

/** Sunday 22 November 2026, 14:00 in Manila. */
const NOW = new Date("2026-11-22T06:00:00.000Z")
const KEY = "3f1c2b7e-8a4d-4e5f-9b6a-0c1d2e3f4a5b"

/** A query that resolves to `rows` however it is chained. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {
		from: () => chain,
		where: () => chain,
		orderBy: () => chain,
		then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
	}
	return chain
}

const row = (overrides: Record<string, unknown> = {}) => ({
	id: 1,
	documentKey: KEY,
	version: 1,
	title: "Terms of booking",
	body: "Arrive 15 minutes early.",
	appliesToAllServices: true,
	serviceIds: [] as number[],
	effectiveFrom: "2026-11-22",
	requiresAcceptance: true,
	withdrawnAt: null as Date | null,
	createdBy: "admin-1",
	createdAt: NOW,
	...overrides,
})

const input = {
	title: "Terms of booking",
	body: "Arrive 15 minutes early.",
	appliesToAllServices: false,
	serviceIds: [2],
	effectiveFrom: "2026-12-01",
	requiresAcceptance: true,
}

/** A transaction that answers its selects in order and records inserts and updates. */
function mockTransaction(selects: unknown[][], inserted: unknown = row()) {
	const values = jest.fn()
	const set = jest.fn()
	const execute = jest.fn().mockResolvedValue(undefined)
	const select = jest.fn()
	for (const rows of selects) select.mockReturnValueOnce(query(rows))
	const tx = {
		execute,
		select,
		insert: jest.fn().mockReturnValue({
			values: (value: unknown) => {
				values(value)
				return { returning: () => Promise.resolve([inserted]) }
			},
		}),
		update: jest.fn().mockReturnValue({
			set: (value: unknown) => {
				set(value)
				return { where: () => Promise.resolve(undefined) }
			},
		}),
	}
	jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
	return { tx, values, set, execute }
}

/** The reads `readBack` makes after a write: all versions, service names, creator emails. */
function mockReadBack(rows: unknown[]) {
	jest
		.mocked(db.select)
		.mockReturnValueOnce(query(rows) as never)
		.mockReturnValueOnce(query([{ id: 2, name: "Yellow fever vaccination" }]) as never)
		.mockReturnValueOnce(query([{ id: "admin-1", email: "admin@qsps.local" }]) as never)
}

describe("PolicyDocumentService (ADM-9)", () => {
	let auditService: { record: jest.Mock }
	let service: PolicyDocumentService

	beforeEach(() => {
		jest.resetAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		service = new PolicyDocumentService(auditService as unknown as AuditService)
	})

	it("publishes version 1 and audits it in the same transaction", async () => {
		const created = row({
			appliesToAllServices: false,
			serviceIds: [2],
			effectiveFrom: "2026-12-01",
		})
		const { tx, values } = mockTransaction([[{ id: 2 }]], created)
		mockReadBack([created])

		const policy = await service.create(input, "admin-1", NOW)

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({ version: 1, serviceIds: [2], createdBy: "admin-1" })
		)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "settings",
				action: "policy_document.create",
				targetType: "policy_document",
				targetId: KEY,
				oldValue: null,
			}),
			tx
		)
		expect(policy).toMatchObject({
			state: "scheduled",
			serviceNames: ["Yellow fever vaccination"],
			createdByEmail: "admin@qsps.local",
		})
	})

	it("refuses an effective date in the past before opening a transaction", async () => {
		await expect(
			service.create({ ...input, effectiveFrom: "2026-11-21" }, "admin-1", NOW)
		).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(db.transaction).not.toHaveBeenCalled()
	})

	it("refuses a service that does not exist", async () => {
		mockTransaction([[]])
		await expect(service.create(input, "admin-1", NOW)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		})
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("refuses a write with no signed-in user", async () => {
		await expect(service.create(input, null, NOW)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
	})

	it("writes an edit as the next version under a lock, keeping the old one", async () => {
		const v1 = row()
		const v2 = row({ id: 2, version: 2, serviceIds: [2], appliesToAllServices: false })
		const { tx, values, execute, set } = mockTransaction([[v1], [{ id: 2 }]], v2)
		mockReadBack([v1, v2])

		await service.update({ ...input, documentKey: KEY }, "admin-1", NOW)

		expect(execute).toHaveBeenCalledTimes(1)
		expect(set).not.toHaveBeenCalled()
		expect(values).toHaveBeenCalledWith(expect.objectContaining({ documentKey: KEY, version: 2 }))
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "policy_document.version",
				oldValue: expect.objectContaining({ id: 1, version: 1 }),
				newValue: expect.objectContaining({ id: 2, version: 2 }),
			}),
			tx
		)
	})

	it("refuses to edit a withdrawn policy", async () => {
		mockTransaction([[row({ withdrawnAt: NOW })]])
		await expect(
			service.update({ ...input, documentKey: KEY }, "admin-1", NOW)
		).rejects.toMatchObject({ code: "CONFLICT" })
	})

	it("returns not found for an unknown policy", async () => {
		mockTransaction([[]])
		await expect(
			service.update({ ...input, documentKey: KEY }, "admin-1", NOW)
		).rejects.toMatchObject({ code: "NOT_FOUND" })
	})

	it("withdraws every version and audits it; withdrawing again changes nothing", async () => {
		const { tx, set } = mockTransaction([[row()]])
		mockReadBack([row({ withdrawnAt: NOW })])

		const policy = await service.withdraw(KEY, "admin-1", NOW)

		expect(set).toHaveBeenCalledWith({ withdrawnAt: NOW })
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({ action: "policy_document.withdraw", targetId: KEY }),
			tx
		)
		expect(policy.state).toBe("withdrawn")

		jest.resetAllMocks()
		const again = mockTransaction([[row({ withdrawnAt: NOW })]])
		mockReadBack([row({ withdrawnAt: NOW })])
		await service.withdraw(KEY, "admin-1", NOW)
		expect(again.set).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("lists the newest version, saying when an older one still applies", async () => {
		const v1 = row()
		const v2 = row({ id: 2, version: 2, effectiveFrom: "2026-12-01" })
		jest
			.mocked(db.select)
			.mockReturnValueOnce(query([v1, v2]) as never)
			.mockReturnValueOnce(query([{ id: "admin-1", email: "admin@qsps.local" }]) as never)

		const [policy] = await service.list(NOW)

		expect(policy).toMatchObject({
			id: 2,
			version: 2,
			state: "scheduled",
			olderVersionInEffect: true,
		})
	})
})
