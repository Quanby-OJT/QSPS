import { ORPCError } from "@orpc/server"

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
	},
}))

describe("LocationsService", () => {
	let service: LocationsService
	let auditService: { record: jest.Mock }

	beforeEach(() => {
		jest.clearAllMocks()
		auditService = { record: jest.fn().mockResolvedValue(undefined) }
		service = new LocationsService(auditService as unknown as AuditService)
	})

	it("audits and refuses physical deletion, directing callers to disable", async () => {
		const location = {
			code: "MNL",
			name: "Manila",
			address: "Port Area, Manila",
			region: "NCR",
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		}
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
