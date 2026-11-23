import { formSubmissions } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"
import type { PolicyService } from "@/common/policy/policy.service"

import { BookingService } from "./bookings.service"
import { generateReferenceNumber } from "./reference-number"

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

jest.mock("@/common/database/database.client", () => ({ db: { transaction: jest.fn() } }))
jest.mock("@/common/policy/policy.service", () => ({ PolicyService: jest.fn() }))
jest.mock("./reference-number", () => ({ generateReferenceNumber: jest.fn() }))

beforeEach(() => {
	jest.spyOn(NotificationService, "enqueue").mockResolvedValue(undefined)
	jest.mocked(generateReferenceNumber).mockReturnValue("QSPS-261117-AB12CD")
})
afterEach(() => jest.restoreAllMocks())

/** Tuesday 17 November 2026, 15:00 in Manila. */
const NOW = new Date("2026-11-17T07:00:00.000Z")
const EARLIER = new Date("2026-11-17T06:30:00.000Z")

const slot = {
	id: 7,
	serviceId: 1,
	locationId: 2,
	startsAt: new Date("2026-12-02T00:00:00.000Z"),
	endsAt: new Date("2026-12-02T04:00:00.000Z"),
	capacity: 20,
	bookedCount: 0,
	isDisabled: false,
}
const service = { id: 1, name: "Yellow fever vaccination", feeCentavos: 150000, isActive: true }
const location = { id: 2, name: "Manila", isActive: true }
const savedBooking = {
	id: 31,
	referenceNumber: "QSPS-261117-AB12CD",
	clientId: "client-1",
	status: "pending_payment",
	kind: "regular",
	totalCentavos: 150000,
	holdExpiresAt: new Date("2026-11-17T08:00:00.000Z"),
	payOnsite: false,
	cancelReason: null,
	cancelledAt: null,
	createdAt: NOW,
}
const savedItem = {
	id: 44,
	bookingId: 31,
	serviceId: 1,
	scheduleSlotId: 7,
	locationId: 2,
	feeCentavos: 150000,
	status: "booked",
}

const prepared = { formTemplateId: 11, version: 2, answers: { "100": "Ana" } }

/** A transaction whose selects answer `selects` in order, recording every write. */
function fakeTransaction(selects: unknown[][], insertReturns: unknown[][] = []) {
	const inserted: { table: unknown; values: unknown }[] = []
	const updated: { table: unknown; values: unknown }[] = []
	const select = jest.fn(() => {
		const rows = selects.shift() ?? []
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			innerJoin: () => chain,
			orderBy: () => chain,
			limit: () => Promise.resolve(rows),
			for: () => Promise.resolve(rows),
			then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
				Promise.resolve(rows).then(resolve, reject),
		}
		return chain
	})
	const insert = jest.fn((table: unknown) => ({
		values: (values: unknown) => {
			inserted.push({ table, values })
			return {
				returning: () => Promise.resolve(insertReturns.shift() ?? []),
				then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
					Promise.resolve(undefined).then(resolve, reject),
			}
		},
	}))
	const update = jest.fn((table: unknown) => ({
		set: (values: unknown) => {
			updated.push({ table, values })
			return { where: () => Promise.resolve(undefined) }
		},
	}))
	jest
		.mocked(db.transaction)
		.mockImplementation(callback => callback({ select, insert, update } as never) as never)
	return { inserted, updated }
}

function setup() {
	const audit = { record: jest.fn().mockResolvedValue(undefined) }
	const policies = { get: jest.fn().mockResolvedValue(60) }
	const forms = { prepare: jest.fn().mockResolvedValue(prepared) }
	const service = new BookingService(
		audit as unknown as AuditService,
		policies as unknown as PolicyService,
		forms
	)
	return { audit, forms, service }
}

describe("BookingService.create with a questionnaire (FRM-2)", () => {
	const input = {
		items: [{ scheduleSlotId: 7, form: { formTemplateId: 11, answers: { "100": "Ana" } } }],
		acceptedPolicyDocumentIds: [],
	}

	function bookingSelects() {
		return [[{ id: "client-1" }], [], [slot], [service], [location], [], []]
	}

	it("checks the item's answers and stores them against the version", async () => {
		const { audit, forms, service: bookingService } = setup()
		const { inserted } = fakeTransaction(bookingSelects(), [[savedBooking], [savedItem]])

		await bookingService.create(input, "client-1", NOW)

		expect(forms.prepare).toHaveBeenCalledWith(expect.anything(), {
			serviceId: 1,
			serviceName: "Yellow fever vaccination",
			form: { formTemplateId: 11, answers: { "100": "Ana" } },
			actorId: "client-1",
			errorData: { scheduleSlotId: 7 },
		})
		expect(inserted.find(row => row.table === formSubmissions)?.values).toEqual([
			{ bookingItemId: 44, formTemplateId: 11, answers: { "100": "Ana" } },
		])
		const entry = audit.record.mock.calls[0]?.[0] as { newValue: Record<string, unknown> }
		expect(entry.newValue.formSubmissions).toEqual([{ bookingItemId: 44, formTemplateId: 11 }])
		expect(JSON.stringify(audit.record.mock.calls)).not.toContain("Ana")
	})

	it("creates nothing when the answers are refused", async () => {
		const { forms, service: bookingService } = setup()
		forms.prepare.mockRejectedValue(
			new Error("Some answers for Yellow fever vaccination need fixing.")
		)
		const { inserted } = fakeTransaction(bookingSelects(), [[savedBooking], [savedItem]])

		await expect(bookingService.create(input, "client-1", NOW)).rejects.toThrow("need fixing")
		expect(inserted).toEqual([])
	})
})

describe("BookingService.updateItemForm (FRM-2)", () => {
	const input = { bookingId: 31, bookingItemId: 44, formTemplateId: 11, answers: { "100": "Ana" } }
	const item = { id: 44, serviceId: 1, serviceName: "Yellow fever vaccination" }

	it("replaces the answers of an unpaid booking", async () => {
		const { audit, service: bookingService } = setup()
		const { updated } = fakeTransaction([
			[{ clientId: "client-1", status: "pending_payment" }],
			[item],
			[{ id: 5, formTemplateId: 10, createdAt: EARLIER }],
		])

		const result = await bookingService.updateItemForm(input, "client-1", NOW)

		expect(result).toEqual({
			bookingItemId: 44,
			formTemplateId: 11,
			version: 2,
			answers: { "100": "Ana" },
			createdAt: EARLIER,
		})
		expect(updated).toEqual([
			{ table: formSubmissions, values: { formTemplateId: 11, answers: { "100": "Ana" } } },
		])
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "form_submission.update",
				oldValue: { formTemplateId: 10 },
				newValue: { formTemplateId: 11, answeredQuestionIds: ["100"] },
			}),
			expect.anything()
		)
		expect(JSON.stringify(audit.record.mock.calls)).not.toContain("Ana")
	})

	it("stores the first answers when there were none", async () => {
		const { service: bookingService } = setup()
		const { inserted } = fakeTransaction([
			[{ clientId: "client-1", status: "pending_payment" }],
			[item],
			[],
		])

		await bookingService.updateItemForm(input, "client-1", NOW)

		expect(inserted).toEqual([
			{
				table: formSubmissions,
				values: {
					bookingItemId: 44,
					formTemplateId: 11,
					answers: { "100": "Ana" },
					createdAt: NOW,
				},
			},
		])
	})

	it("refuses once the booking is paid, before checking anything", async () => {
		const { forms, service: bookingService } = setup()
		fakeTransaction([[{ clientId: "client-1", status: "paid" }]])

		await expect(bookingService.updateItemForm(input, "client-1", NOW)).rejects.toThrow(
			"already paid"
		)
		expect(forms.prepare).not.toHaveBeenCalled()
	})

	it("answers someone else's booking like a missing one and audits the attempt", async () => {
		const { audit, service: bookingService } = setup()
		fakeTransaction([[{ clientId: "someone-else", status: "pending_payment" }]])

		await expect(bookingService.updateItemForm(input, "client-1", NOW)).rejects.toThrow(
			"Booking not found"
		)
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "form_submission.update",
				outcome: "denied",
				reason: "not_owner",
			})
		)
	})
})
