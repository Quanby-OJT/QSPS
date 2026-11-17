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
	code: "YF-VAX",
	name: "Yellow fever vaccination",
	feeCentavos: 12500,
	requiresApproval: true,
	documentType: null,
	isActive: true,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	...overrides,
})

const makeCategory = () => ({ id: 3, code: "immunization", name: "Immunization" })

/** select().from().where() resolving to rows. */
const selectRows = (rows: unknown[]) => ({
	from: () => ({ where: () => Promise.resolve(rows) }),
})
/** select().from().where().limit() resolving to rows. */
const selectLimited = (rows: unknown[]) => ({
	from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
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

	it("creates a service with its code, fee, approval setting and document type, and audits it", async () => {
		const created = makeService({ documentType: "Vaccination Certificate" })
		const values = jest.fn().mockReturnValue({
			onConflictDoNothing: () => ({ returning: () => Promise.resolve([created]) }),
		})
		const tx = mockTransaction({
			select: jest
				.fn()
				.mockReturnValueOnce(selectRows([makeCategory()]))
				.mockReturnValueOnce(selectLimited([])),
			insert: jest.fn().mockReturnValue({ values }),
		})

		await expect(
			service.create(
				{
					serviceCategoryId: 3,
					code: "YF-VAX",
					name: "Yellow fever vaccination",
					feeCentavos: 12500,
					requiresApproval: true,
					documentType: "Vaccination Certificate",
				},
				"staff-1"
			)
		).resolves.toMatchObject({
			code: "YF-VAX",
			categoryCode: "immunization",
			requiresApproval: true,
			documentType: "Vaccination Certificate",
			isActive: true,
		})

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({ code: "YF-VAX", documentType: "Vaccination Certificate" })
		)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "services",
				action: "service.create",
				actorId: "staff-1",
				targetId: "42",
				oldValue: null,
				newValue: expect.objectContaining({ code: "YF-VAX", feeCentavos: 12500 }),
			}),
			tx
		)
	})

	it("refuses a duplicate service code without writing or auditing", async () => {
		const insert = jest.fn()
		mockTransaction({
			select: jest
				.fn()
				.mockReturnValueOnce(selectRows([makeCategory()]))
				.mockReturnValueOnce(selectLimited([{ id: 7 }])),
			insert,
		})

		await expect(
			service.create(
				{
					serviceCategoryId: 3,
					code: "YF-VAX",
					name: "Another name",
					feeCentavos: 100,
					requiresApproval: false,
				},
				"staff-1"
			)
		).rejects.toMatchObject({ code: "CONFLICT" })
		expect(insert).not.toHaveBeenCalled()
		expect(auditService.record).not.toHaveBeenCalled()
	})

	it("audits fee changes with the previous and current centavo values in the transaction", async () => {
		const current = makeService()
		const updated = makeService({ feeCentavos: 15000 })
		const returning = jest.fn().mockResolvedValue([updated])
		const set = jest.fn().mockReturnValue({ where: () => ({ returning }) })
		const tx = mockTransaction({
			select: jest
				.fn()
				.mockReturnValueOnce(selectRows([current]))
				.mockReturnValueOnce(selectRows([makeCategory()]))
				.mockReturnValueOnce(selectLimited([])),
			update: jest.fn().mockReturnValue({ set }),
		})

		await expect(service.update({ id: 42, feeCentavos: 15000 }, "staff-1")).resolves.toMatchObject({
			id: 42,
			feeCentavos: 15000,
		})

		// An update that does not mention the document type keeps it.
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({ feeCentavos: 15000, documentType: null })
		)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "service.fee.update",
				targetId: "42",
				oldValue: expect.objectContaining({ feeCentavos: 12500 }),
				newValue: expect.objectContaining({ feeCentavos: 15000 }),
			}),
			tx
		)
	})

	it("lists only active services in the catalog", async () => {
		const orderBy = jest.fn().mockResolvedValue([{ service: makeService(), category: makeCategory() }])
		const where = jest.fn().mockReturnValue({ orderBy })
		const innerJoin = jest.fn().mockReturnValue({ where })
		jest.mocked(db.select).mockReturnValue({ from: () => ({ innerJoin }) } as never)

		await expect(service.listAvailable()).resolves.toMatchObject([
			{ id: 42, code: "YF-VAX", categoryCode: "immunization" },
		])
		expect(where).toHaveBeenCalledWith(eq(services.isActive, true))
	})
})