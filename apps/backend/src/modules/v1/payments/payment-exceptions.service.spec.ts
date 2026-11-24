import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { ResolvedScope } from "@/common/scope/scope-match"

import { PaymentExceptionsService } from "./payment-exceptions.service"
import type { PaymentService } from "./payments.service"

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
	db: { select: jest.fn() },
}))

// Loading the real one would pull in @repo/contracts runtime code.
jest.mock("./payments.service", () => ({ PaymentService: jest.fn() }))

const PAID_AT = new Date("2026-11-24T02:00:00.000Z")

function flagged(overrides: Record<string, unknown> = {}) {
	return {
		paymentId: 92,
		bookingId: 31,
		referenceNumber: "QSPS-261124-AB12CD",
		bookingStatus: "cancelled",
		clientName: "Sam Rivera",
		clientEmail: "sam@qsps.local",
		amountCentavos: 151500,
		channelCode: "gcash",
		providerCode: "fake",
		paidAt: PAID_AT,
		receiptNumber: "QSPS-R-261124-000092",
		...overrides,
	}
}

/** Each `select` resolves to the next entry, however the query ends. */
function fakeDatabase(selects: unknown[][]) {
	const queue = [...selects]
	;(db.select as jest.Mock).mockImplementation(() => {
		const rows = queue.shift() ?? []
		const chain: Record<string, unknown> = {
			then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
				Promise.resolve(rows).then(resolve, reject),
			from: () => chain,
			innerJoin: () => chain,
			leftJoin: () => chain,
			where: () => chain,
			orderBy: () => chain,
			limit: () => Promise.resolve(rows),
		}
		return chain
	})
}

const atBacolod: ResolvedScope = { nationwide: false, entries: [{ serviceCategoryId: null, locationId: 5 }] }
const atManila: ResolvedScope = { nationwide: false, entries: [{ serviceCategoryId: null, locationId: 9 }] }

describe("PaymentExceptionsService (PAY-6)", () => {
	let audit: { record: jest.Mock }
	let paymentService: { resolveReview: jest.Mock }
	let service: PaymentExceptionsService

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		paymentService = { resolveReview: jest.fn() }
		service = new PaymentExceptionsService(
			audit as unknown as AuditService,
			paymentService as unknown as PaymentService
		)
	})

	describe("list", () => {
		it("shows a late payment on a cancelled booking", async () => {
			fakeDatabase([[flagged()], [{ bookingId: 31, locationId: 5 }], []])

			await expect(service.list(atBacolod)).resolves.toEqual({
				exceptions: [{ ...flagged(), reason: "late_payment" }],
			})
		})

		it("names a second payment on a booking another payment paid as a duplicate", async () => {
			fakeDatabase([
				[flagged({ bookingStatus: "paid", receiptNumber: null })],
				[{ bookingId: 31, locationId: 5 }],
				[{ bookingId: 31, id: 88 }],
			])

			const { exceptions } = await service.list(atBacolod)

			expect(exceptions[0]).toMatchObject({ reason: "duplicate", receiptNumber: null })
		})

		it("leaves out exceptions at a Location outside the caller's Scope", async () => {
			fakeDatabase([[flagged()], [{ bookingId: 31, locationId: 5 }], []])

			await expect(service.list(atManila)).resolves.toEqual({ exceptions: [] })
		})

		it("returns an empty list without further queries when nothing needs review", async () => {
			fakeDatabase([[]])

			await expect(service.list(atBacolod)).resolves.toEqual({ exceptions: [] })
			expect(db.select).toHaveBeenCalledTimes(1)
		})
	})

	describe("resolve", () => {
		const input = {
			paymentId: 92,
			resolution: "refund_requested" as const,
			note: "Return the late payment",
		}

		it("checks Scope, then resolves through PaymentService", async () => {
			fakeDatabase([[{ bookingId: 31 }], [{ locationId: 5 }]])
			paymentService.resolveReview.mockResolvedValue({
				paymentId: 92,
				resolution: "refund_requested",
				refundRequestId: 5,
			})

			await expect(service.resolve(input, "staff-1", atBacolod)).resolves.toMatchObject({ refundRequestId: 5 })
			expect(paymentService.resolveReview).toHaveBeenCalledWith(input, "staff-1", expect.any(Date))
		})

		it("answers 404 and audits a denial outside Scope, changing nothing", async () => {
			fakeDatabase([[{ bookingId: 31 }], [{ locationId: 5 }]])

			await expect(service.resolve(input, "staff-2", atManila)).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(paymentService.resolveReview).not.toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "scope.check",
					outcome: "denied",
					actorId: "staff-2",
					targetType: "payment",
					targetId: "92",
				})
			)
		})

		it("answers 404 for an unknown payment", async () => {
			fakeDatabase([[]])

			await expect(service.resolve(input, "staff-1", atBacolod)).rejects.toMatchObject({ code: "NOT_FOUND" })
		})

		it("needs a signed-in user", async () => {
			await expect(service.resolve(input, null, atBacolod)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		})
	})
})
