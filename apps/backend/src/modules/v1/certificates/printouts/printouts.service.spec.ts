import { ConflictException, NotFoundException } from "@nestjs/common"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { PdfService } from "@/common/pdf/pdf.service"
import { readableAnswers } from "@/modules/v1/forms/form-answers-display"

import { PrintoutService } from "./printouts.service"

jest.mock("@/common/database/database.client", () => ({
	db: { select: jest.fn() },
}))
jest.mock("@/modules/v1/forms/form-answers-display", () => ({
	readableAnswers: jest.fn(),
}))

const answers = readableAnswers as unknown as jest.Mock

/** A query that resolves to `rows` however it is finished. */
function query(rows: unknown[]) {
	const chain: Record<string, unknown> = {}
	for (const step of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
		chain[step] = () => chain
	}
	chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
		Promise.resolve(rows).then(resolve, reject)
	return chain
}

/** Each `db.select` call answers with the next list of rows, in order. */
function selectReturns(...results: unknown[][]) {
	const select = db.select as unknown as jest.Mock
	select.mockReset()
	for (const rows of results) select.mockReturnValueOnce(query(rows))
}

const itemRow = {
	id: 44,
	bookingId: 31,
	locationId: 2,
	serviceName: "Physical Examination",
	serviceCategoryId: 3,
	categoryCode: "physical-exam",
	locationName: "BOQ Manila",
	referenceNumber: "QSPS-261124-AB12CD",
	clientId: "client-1",
	clientName: "Juan Dela Cruz",
	email: "juan@example.com",
	mobile: "09171234567",
	birthDate: "1990-05-17",
	gender: "Male",
	nationality: "Filipino",
}

const bookingRow = {
	id: 31,
	referenceNumber: "QSPS-261124-AB12CD",
	status: "pending_payment",
	totalCentavos: 185050,
	clientName: "Juan Dela Cruz",
}

const examItem = {
	serviceName: "Physical Examination",
	feeCentavos: 150000,
	locationName: "BOQ Manila",
	locationId: 2,
	serviceCategoryId: 3,
	categoryCode: "physical-exam",
}
const xrayItem = { ...examItem, serviceName: "Chest X-ray", feeCentavos: 35050 }

/** The staff member may act on Category 3 at Location 2. */
const staffScope = { nationwide: false, entries: [{ serviceCategoryId: 3, locationId: 2 }] }
/** Somewhere else entirely. */
const otherScope = { nationwide: false, entries: [{ serviceCategoryId: 9, locationId: 9 }] }

describe("PrintoutService", () => {
	let audit: { record: jest.Mock }
	let service: PrintoutService

	beforeEach(() => {
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		answers.mockReset()
		service = new PrintoutService(audit as unknown as AuditService, new PdfService())
	})

	describe("applicationFormForStaff", () => {
		it("prints the Local form for a Physical Examination item in Scope, and audits it", async () => {
			selectReturns([itemRow])
			answers.mockResolvedValue({ "Applicant type": "Local", "Purpose of examination": "Work" })

			const result = await service.applicationFormForStaff(44, "staff-1", staffScope)

			expect(result.fileName).toBe("application-form-QSPS-261124-AB12CD.pdf")
			expect(result.pdf.subarray(0, 4).toString()).toBe("%PDF")
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "certificates",
					action: "printout.application",
					actorId: "staff-1",
					targetType: "booking_item",
					targetId: "44",
					// Names the printout only; the client's answers stay out of the audit.
					newValue: {
						bookingId: 31,
						referenceNumber: "QSPS-261124-AB12CD",
						variant: "local",
					},
				})
			)
		})

		it("prints the Foreign form when the client answered Foreign", async () => {
			selectReturns([itemRow])
			answers.mockResolvedValue({ "Applicant type": "Foreign" })

			await service.applicationFormForStaff(44, "staff-1", staffScope)

			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ newValue: expect.objectContaining({ variant: "foreign" }) })
			)
		})

		it("works for a nationwide user when no Scope is given", async () => {
			selectReturns([itemRow])
			answers.mockResolvedValue({ "Applicant type": "Local" })

			const result = await service.applicationFormForStaff(44, "admin-1")

			expect(result.pdf.subarray(0, 4).toString()).toBe("%PDF")
		})

		it("answers 404 and audits a denial for an item outside the caller's Scope", async () => {
			selectReturns([itemRow])

			await expect(service.applicationFormForStaff(44, "staff-1", otherScope)).rejects.toThrow(
				NotFoundException
			)

			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "printout.application",
					outcome: "denied",
					actorId: "staff-1",
					targetId: "44",
					reason: "outside_scope",
				})
			)
		})

		it("answers 404 without an audit entry when the item does not exist", async () => {
			selectReturns([])

			await expect(service.applicationFormForStaff(99, "staff-1", staffScope)).rejects.toThrow(
				NotFoundException
			)
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("refuses to guess when the client has not said Local or Foreign", async () => {
			selectReturns([itemRow])
			answers.mockResolvedValue({})

			await expect(service.applicationFormForStaff(44, "staff-1", staffScope)).rejects.toThrow(
				/Applicant type/
			)
		})

		it("refuses an item that is not a Physical Examination Service", async () => {
			selectReturns([{ ...itemRow, categoryCode: "immunization" }])

			await expect(service.applicationFormForStaff(44, "staff-1", staffScope)).rejects.toThrow(
				ConflictException
			)
		})
	})

	describe("applicationFormForOwner", () => {
		it("lets the client download their own form, with no audit entry", async () => {
			selectReturns([itemRow])
			answers.mockResolvedValue({ "Applicant type": "Local" })

			const result = await service.applicationFormForOwner(44, "client-1")

			expect(result.pdf.subarray(0, 4).toString()).toBe("%PDF")
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("answers 404 and audits a denial for another client", async () => {
			selectReturns([itemRow])

			await expect(service.applicationFormForOwner(44, "client-2")).rejects.toThrow(
				NotFoundException
			)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "printout.application.read",
					outcome: "denied",
					actorId: "client-2",
					reason: "not_owner",
				})
			)
		})

		it("answers the same 404 for an item that does not exist", async () => {
			selectReturns([])

			await expect(service.applicationFormForOwner(99, "client-1")).rejects.toThrow(
				NotFoundException
			)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", reason: "not_found" })
			)
		})

		it("answers 404 when nobody is signed in", async () => {
			selectReturns([itemRow])

			await expect(service.applicationFormForOwner(44, null)).rejects.toThrow(NotFoundException)
			expect(audit.record).not.toHaveBeenCalled()
		})
	})

	describe("requestForPaymentForStaff", () => {
		it("prints the Request for Payment for a booking awaiting payment, and audits it", async () => {
			selectReturns([bookingRow], [examItem, xrayItem])

			const result = await service.requestForPaymentForStaff(31, "staff-1", staffScope)

			expect(result.fileName).toBe("request-for-payment-QSPS-261124-AB12CD.pdf")
			expect(result.pdf.subarray(0, 4).toString()).toBe("%PDF")
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "printout.request_for_payment",
					actorId: "staff-1",
					targetType: "booking",
					targetId: "31",
					newValue: { referenceNumber: "QSPS-261124-AB12CD", totalCentavos: 185050 },
				})
			)
		})

		it("refuses a booking that is already paid", async () => {
			selectReturns([{ ...bookingRow, status: "paid" }], [examItem])

			await expect(service.requestForPaymentForStaff(31, "staff-1", staffScope)).rejects.toThrow(
				/already paid/
			)
		})

		it("refuses a booking that can no longer be paid, and says why", async () => {
			selectReturns([{ ...bookingRow, status: "cancelled" }], [examItem])

			await expect(service.requestForPaymentForStaff(31, "staff-1", staffScope)).rejects.toThrow(
				/cancelled/
			)
		})

		it("refuses a booking with no Physical Examination item", async () => {
			selectReturns([bookingRow], [{ ...examItem, categoryCode: "immunization" }])

			await expect(service.requestForPaymentForStaff(31, "staff-1", staffScope)).rejects.toThrow(
				ConflictException
			)
		})

		it("answers 404 and audits a denial when any item is outside the caller's Scope", async () => {
			selectReturns([bookingRow], [examItem, { ...xrayItem, locationId: 8 }])

			await expect(service.requestForPaymentForStaff(31, "staff-1", staffScope)).rejects.toThrow(
				NotFoundException
			)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "printout.request_for_payment",
					outcome: "denied",
					reason: "outside_scope",
				})
			)
		})

		it("answers 404 without an audit entry when the booking does not exist", async () => {
			selectReturns([])

			await expect(service.requestForPaymentForStaff(99, "staff-1", staffScope)).rejects.toThrow(
				NotFoundException
			)
			expect(audit.record).not.toHaveBeenCalled()
		})
	})
})
