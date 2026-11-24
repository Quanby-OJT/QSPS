import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import type { ResolvedScope } from "@/common/scope/scope-match"

import { CashierService } from "./cashier.service"
import type { PaymentService } from "./payments.service"
import type { ReceiptService } from "./receipts.service"

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

// Loading these would pull in the PDF library, env config and @repo/contracts
// runtime code; the tests pass stand-ins instead.
jest.mock("./payments.service", () => ({ PaymentService: jest.fn() }))
jest.mock("./receipts.service", () => ({ ReceiptService: jest.fn() }))

const STARTS = new Date("2026-11-25T00:00:00.000Z")
const ENDS = new Date("2026-11-25T04:00:00.000Z")

const unpaid = {
	id: 31,
	referenceNumber: "QSPS-261124-AB12CD",
	status: "pending_payment",
	totalCentavos: 150000,
	clientName: "Sam Rivera",
	clientEmail: "sam@qsps.local",
}

function item(overrides: Record<string, unknown> = {}) {
	return {
		bookingId: 31,
		serviceName: "Yellow fever vaccination",
		locationName: "Bacolod",
		startsAt: STARTS,
		endsAt: ENDS,
		feeCentavos: 150000,
		serviceCategoryId: 3,
		locationId: 5,
		...overrides,
	}
}

/** Each `select` resolves to the next entry, however the query ends. */
function fakeDatabase(selects: unknown[][]) {
	const queue = [...selects]
	const conditions: unknown[] = []
	;(db.select as jest.Mock).mockImplementation(() => {
		const rows = queue.shift() ?? []
		const chain: Record<string, unknown> = {
			then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
				Promise.resolve(rows).then(resolve, reject),
			from: () => chain,
			innerJoin: () => chain,
			leftJoin: () => chain,
			where: (condition: unknown) => {
				conditions.push(condition)
				return chain
			},
			orderBy: () => chain,
			limit: () => Promise.resolve(rows),
		}
		return chain
	})
	return { conditions }
}

const atBacolod: ResolvedScope = {
	nationwide: false,
	entries: [{ serviceCategoryId: null, locationId: 5 }],
}
const atManila: ResolvedScope = {
	nationwide: false,
	entries: [{ serviceCategoryId: null, locationId: 9 }],
}

describe("CashierService (PAY-4)", () => {
	let audit: { record: jest.Mock }
	let paymentService: { collectOnsite: jest.Mock }
	let receiptService: { renderForStaff: jest.Mock }
	let service: CashierService

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		paymentService = { collectOnsite: jest.fn() }
		receiptService = { renderForStaff: jest.fn() }
		service = new CashierService(
			audit as unknown as AuditService,
			paymentService as unknown as PaymentService,
			receiptService as unknown as ReceiptService
		)
	})

	describe("search", () => {
		it("finds a booking by its Reference Number, scanned or typed in lower case, with the fee breakdown", async () => {
			fakeDatabase([[unpaid], [item()], []])

			const result = await service.search(" qsps-261124-ab12cd ", "cashier-1", atBacolod)

			expect(result.bookings).toEqual([
				{
					bookingId: 31,
					referenceNumber: "QSPS-261124-AB12CD",
					status: "pending_payment",
					clientName: "Sam Rivera",
					clientEmail: "sam@qsps.local",
					items: [
						{
							serviceName: "Yellow fever vaccination",
							locationName: "Bacolod",
							startsAt: STARTS,
							endsAt: ENDS,
							feeCentavos: 150000,
						},
					],
					totalCentavos: 150000,
					paidPayment: null,
				},
			])
		})

		it("shows a paid booking with its receipt, so its status is clear and it can be reprinted", async () => {
			fakeDatabase([
				[{ ...unpaid, status: "paid" }],
				[item()],
				[{ paymentId: 91, receiptNumber: "QSPS-R-261124-000091" }],
			])

			const result = await service.search("QSPS-261124-AB12CD", "cashier-1", atBacolod)

			expect(result.bookings[0]).toMatchObject({
				status: "paid",
				paidPayment: { paymentId: 91, receiptNumber: "QSPS-R-261124-000091" },
			})
		})

		it("answers 404 and audits a denial for a Reference Number at another Location", async () => {
			fakeDatabase([[unpaid], [item()]])

			await expect(service.search("QSPS-261124-AB12CD", "cashier-2", atManila)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "scope.check",
					outcome: "denied",
					actorId: "cashier-2",
					targetType: "booking",
					targetId: "31",
				})
			)
		})

		it("returns nothing for an unknown Reference Number", async () => {
			fakeDatabase([[]])

			await expect(service.search("QSPS-261124-ZZZZZZ", "cashier-1", atBacolod)).resolves.toEqual({
				bookings: [],
			})
		})

		it("by name or email, leaves out bookings outside the cashier's Scope", async () => {
			const other = { ...unpaid, id: 32, referenceNumber: "QSPS-261124-CD34EF" }
			fakeDatabase([
				[unpaid, other],
				[item(), item({ bookingId: 32, locationId: 9, locationName: "Manila" })],
				[],
			])

			const result = await service.search("Sam", "cashier-1", atBacolod)

			expect(result.bookings.map(booking => booking.referenceNumber)).toEqual(["QSPS-261124-AB12CD"])
		})

		it("needs a signed-in cashier", async () => {
			await expect(service.search("Sam", null)).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		})
	})

	describe("collect", () => {
		const input = {
			bookingId: 31,
			tenderType: "cash" as const,
			amountDueCentavos: 150000,
			amountReceivedCentavos: 150000,
		}

		it("checks Scope, then records the payment through PaymentService as the cashier", async () => {
			fakeDatabase([[unpaid], [item()]])
			paymentService.collectOnsite.mockResolvedValue({ paymentId: 91 })

			await expect(service.collect(input, "cashier-1", atBacolod)).resolves.toEqual({ paymentId: 91 })
			expect(paymentService.collectOnsite).toHaveBeenCalledWith(input, "cashier-1", expect.any(Date))
		})

		it("answers 404, audits the denial and records nothing outside Scope", async () => {
			fakeDatabase([[unpaid], [item()]])

			await expect(service.collect(input, "cashier-2", atManila)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(paymentService.collectOnsite).not.toHaveBeenCalled()
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "scope.check", outcome: "denied" })
			)
		})

		it("answers 404 for a booking that does not exist", async () => {
			fakeDatabase([[]])

			await expect(service.collect(input, "cashier-1", atBacolod)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(paymentService.collectOnsite).not.toHaveBeenCalled()
		})
	})

	describe("receipt", () => {
		it("prints the passbook layout for a booking in Scope", async () => {
			fakeDatabase([[{ bookingId: 31 }], [unpaid], [item()]])
			receiptService.renderForStaff.mockResolvedValue({ fileName: "r.pdf", pdf: Buffer.from("%PDF-") })

			await service.receipt(91, "passbook", "cashier-1", atBacolod)

			expect(receiptService.renderForStaff).toHaveBeenCalledWith(91, "passbook")
		})

		it("refuses a receipt for a booking outside Scope", async () => {
			fakeDatabase([[{ bookingId: 31 }], [unpaid], [item()]])

			await expect(service.receipt(91, "a4", "cashier-2", atManila)).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(receiptService.renderForStaff).not.toHaveBeenCalled()
		})
	})
})
