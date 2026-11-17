import { eq } from "drizzle-orm"

import { services } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { ServicesService } from "./services.service"

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

const makeService = (overrides: Record<string, unknown> = {}) => ({
	id: 42,
	serviceCategoryId: 3,
	name: "Yellow fever vaccination",
	feeCentavos: 12500,
	requiresHeadApproval: true,
	isActive: true,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	...overrides,
})

const makeCategory = () => ({
	id: 3,
	code: "immunization",
	name: "Immunization",
})

function mockTransaction(tx: Record<string, unknown>) {
	jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
	return tx
}

describe("ServicesService", () => {
	let service: ServicesService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		service = new ServicesService(auditService as unknown as AuditService)
	})

	it("audits fee changes with the previous and current centavo values in the transaction", async () => {
		const current = makeService()
		const updated = makeService({ feeCentavos: 15000 })
		const select = jest
			.fn()
			.mockReturnValueOnce({
				from: () => ({ where: () => Promise.resolve([current]) }),
			})
			.mockReturnValueOnce({
				from: () => ({ where: () => Promise.resolve([makeCategory()]) }),
			})
			.mockReturnValueOnce({
				from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
			})
		const returning = jest.fn().mockResolvedValue([updated])
		const updateWhere = jest.fn().mockReturnValue({ returning })
		const set = jest.fn().mockReturnValue({ where: updateWhere })
		const tx = mockTransaction({
			select,
			update: jest.fn().mockReturnValue({ set }),
		})

		await expect(service.update({ id: 42, feeCentavos: 15000 }, "staff-1")).resolves.toMatchObject({
			id: 42,
			feeCentavos: 15000,
			categoryCode: "immunization",
		})

		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "services",
				action: "service.fee.update",
				actorId: "staff-1",
				targetType: "service",
				targetId: "42",
				oldValue: expect.objectContaining({ feeCentavos: 12500 }),
				newValue: expect.objectContaining({ feeCentavos: 15000 }),
			}),
			tx
		)
		expect(set).toHaveBeenCalledWith(expect.objectContaining({ feeCentavos: 15000 }))
	})

	it("makes a created service available in the client catalog", async () => {
		const category = makeCategory()
		let persisted = makeService()
		const returning = jest.fn().mockImplementation(async () => [persisted])
		const onConflictDoNothing = jest.fn().mockReturnValue({ returning })
		const values = jest.fn().mockImplementation(input => {
			persisted = { ...persisted, ...input }
			return { onConflictDoNothing }
		})
		mockTransaction({
			select: jest.fn().mockReturnValue({
				from: () => ({ where: () => Promise.resolve([category]) }),
			}),
			insert: jest.fn().mockReturnValue({ values }),
		})

		await expect(
			service.create(
				{
					serviceCategoryId: category.id,
					name: "Yellow fever vaccination",
					feeCentavos: 12500,
					requiresHeadApproval: true,
				},
				"staff-1"
			)
		).resolves.toMatchObject({
			name: "Yellow fever vaccination",
			feeCentavos: 12500,
			requiresHeadApproval: true,
			isActive: true,
		})

		const orderBy = jest.fn().mockResolvedValue([{ service: persisted, category }])
		const where = jest.fn().mockReturnValue({ orderBy })
		const innerJoin = jest.fn().mockReturnValue({ where })
		jest.mocked(db.select).mockReturnValue({
			from: () => ({ innerJoin }),
		} as never)

		await expect(service.listAvailable()).resolves.toMatchObject([
			{
				name: "Yellow fever vaccination",
				feeCentavos: 12500,
				requiresHeadApproval: true,
				categoryCode: "immunization",
			},
		])
	})

	it("lists only active services in the client catalog", async () => {
		const active = makeService()
		const orderBy = jest.fn().mockResolvedValue([{ service: active, category: makeCategory() }])
		const where = jest.fn().mockReturnValue({ orderBy })
		const innerJoin = jest.fn().mockReturnValue({ where })
		const from = jest.fn().mockReturnValue({ innerJoin })
		jest.mocked(db.select).mockReturnValue({ from } as never)

		await expect(service.listAvailable()).resolves.toMatchObject([
			{ id: 42, feeCentavos: 12500, categoryCode: "immunization" },
		])

		expect(where).toHaveBeenCalledWith(eq(services.isActive, true))
	})
})
