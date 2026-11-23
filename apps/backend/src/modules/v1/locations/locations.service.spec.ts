import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import { locations } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { LocationsService } from "./locations.service"

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

const makeLocation = (
	overrides: Partial<{
		code: string
		name: string
		address: string
		region: string
		isActive: boolean
		cardOffsetXMm: number
		cardOffsetYMm: number
	}> = {}
) => ({
	id: 1,
	code: "MNL",
	name: "Manila",
	address: "Port Area, Manila",
	region: "NCR",
	isActive: true,
	cardOffsetXMm: 0,
	cardOffsetYMm: 0,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	...overrides,
})

function mockTransaction(tx: Record<string, unknown>) {
	jest.mocked(db.transaction).mockImplementation(callback => callback(tx as never) as never)
	return tx
}

describe("LocationsService", () => {
	let service: LocationsService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		service = new LocationsService(auditService as unknown as AuditService)
	})

	it("writes a create audit entry in the mutation transaction", async () => {
		const location = makeLocation()
		const returning = jest.fn().mockResolvedValue([location])
		const onConflictDoNothing = jest.fn().mockReturnValue({ returning })
		const values = jest.fn().mockReturnValue({ onConflictDoNothing })
		const tx = mockTransaction({
			insert: jest.fn().mockReturnValue({ values }),
		})

		await expect(
			service.create(
				{ code: "MNL", name: "Manila", address: "Port Area, Manila", region: "NCR" },
				"staff-1"
			)
		).resolves.toEqual(location)

		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "locations",
				action: "location.create",
				actorId: "staff-1",
				targetType: "location",
				targetId: "MNL",
				oldValue: null,
				newValue: {
					code: "MNL",
					name: "Manila",
					address: "Port Area, Manila",
					region: "NCR",
					isActive: true,
					cardOffsetXMm: 0,
					cardOffsetYMm: 0,
				},
			}),
			tx
		)
	})

	it("writes an update audit entry in the mutation transaction", async () => {
		const current = makeLocation()
		const updated = makeLocation({ name: "Manila City" })
		const selectWhere = jest.fn().mockResolvedValue([current])
		const selectFrom = jest.fn().mockReturnValue({ where: selectWhere })
		const returning = jest.fn().mockResolvedValue([updated])
		const updateWhere = jest.fn().mockReturnValue({ returning })
		const set = jest.fn().mockReturnValue({ where: updateWhere })
		const tx = mockTransaction({
			select: jest.fn().mockReturnValue({ from: selectFrom }),
			update: jest.fn().mockReturnValue({ set }),
		})

		await expect(service.update({ code: "MNL", name: "Manila City" }, "staff-1")).resolves.toEqual(
			updated
		)

		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "locations",
				action: "location.update",
				actorId: "staff-1",
				targetType: "location",
				targetId: "MNL",
				oldValue: expect.objectContaining({ name: "Manila" }),
				newValue: expect.objectContaining({ name: "Manila City" }),
			}),
			tx
		)
	})

	it("saves the card print offsets and audits the old and new calibration (CRT-3)", async () => {
		const current = makeLocation()
		const updated = makeLocation({ cardOffsetXMm: 1.5, cardOffsetYMm: -2 })
		const selectWhere = jest.fn().mockResolvedValue([current])
		const selectFrom = jest.fn().mockReturnValue({ where: selectWhere })
		const returning = jest.fn().mockResolvedValue([updated])
		const updateWhere = jest.fn().mockReturnValue({ returning })
		const set = jest.fn().mockReturnValue({ where: updateWhere })
		const tx = mockTransaction({
			select: jest.fn().mockReturnValue({ from: selectFrom }),
			update: jest.fn().mockReturnValue({ set }),
		})

		await service.update({ code: "MNL", cardOffsetXMm: 1.5, cardOffsetYMm: -2 }, "staff-1")

		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Manila",
				cardOffsetXMm: 1.5,
				cardOffsetYMm: -2,
			})
		)
		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "location.update",
				oldValue: expect.objectContaining({ cardOffsetXMm: 0, cardOffsetYMm: 0 }),
				newValue: expect.objectContaining({ cardOffsetXMm: 1.5, cardOffsetYMm: -2 }),
			}),
			tx
		)
	})

	it("writes an active-state audit entry in the mutation transaction", async () => {
		const current = makeLocation()
		const updated = makeLocation({ isActive: false })
		const selectWhere = jest.fn().mockResolvedValue([current])
		const selectFrom = jest.fn().mockReturnValue({ where: selectWhere })
		const returning = jest.fn().mockResolvedValue([updated])
		const updateWhere = jest.fn().mockReturnValue({ returning })
		const set = jest.fn().mockReturnValue({ where: updateWhere })
		const tx = mockTransaction({
			select: jest.fn().mockReturnValue({ from: selectFrom }),
			update: jest.fn().mockReturnValue({ set }),
		})

		await expect(service.setActive({ code: "MNL", isActive: false }, "staff-1")).resolves.toEqual(
			updated
		)

		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "locations",
				action: "location.disable",
				actorId: "staff-1",
				targetType: "location",
				targetId: "MNL",
				oldValue: expect.objectContaining({ isActive: true }),
				newValue: expect.objectContaining({ isActive: false }),
			}),
			tx
		)
	})

	it("lists only active locations for availability", async () => {
		const active = makeLocation()
		const orderBy = jest.fn().mockResolvedValue([active])
		const where = jest.fn().mockReturnValue({ orderBy })
		const from = jest.fn().mockReturnValue({ where })
		jest.mocked(db.select).mockReturnValue({ from } as never)

		await expect(service.listAvailable()).resolves.toEqual([active])

		expect(where).toHaveBeenCalledWith(eq(locations.isActive, true))
		expect(orderBy).toHaveBeenCalledTimes(1)
	})

	it("audits and refuses physical deletion, directing callers to disable", async () => {
		const location = makeLocation()
		const where = jest.fn().mockResolvedValue([location])
		const from = jest.fn().mockReturnValue({ where })
		jest.mocked(db.select).mockReturnValue({ from } as never)

		await expect(service.delete("MNL", "staff-1")).rejects.toMatchObject({
			code: "CONFLICT",
			message: expect.stringContaining("Disable the location instead"),
		})

		expect(auditService.record).toHaveBeenCalledWith(
			expect.objectContaining({
				domain: "locations",
				action: "location.delete",
				outcome: "denied",
				actorId: "staff-1",
				targetId: "MNL",
			})
		)
	})

	it("returns not found when a location does not exist", async () => {
		const where = jest.fn().mockResolvedValue([])
		const from = jest.fn().mockReturnValue({ where })
		jest.mocked(db.select).mockReturnValue({ from } as never)

		await expect(service.delete("MNL", "staff-1")).rejects.toBeInstanceOf(ORPCError)
		expect(auditService.record).not.toHaveBeenCalled()
	})
})
