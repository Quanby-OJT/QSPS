import { ORPCError } from "@orpc/server"

import type { AuditService } from "@/common/audit/audit.service"
import type { PolicyService } from "@/common/policy/policy.service"

import { BookingService } from "./bookings.service"

jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		readonly code: string
		readonly status: number
		readonly data: unknown
		constructor(code: string, options?: { message?: string; data?: unknown }) {
			super(options?.message ?? code)
			this.name = "ORPCError"
			this.code = code
			this.status = code === "NOT_FOUND" ? 404 : code === "UNAUTHORIZED" ? 401 : 400
			this.data = options?.data
		}
	},
}))
jest.mock("@orpc/contract", () => {
	type ChainProxy = ((...args: unknown[]) => ChainProxy) & {
		[key: string]: ChainProxy
	}
	const target = (() => {}) as unknown as ChainProxy
	const chain: ChainProxy = new Proxy(target, {
		get: () => chain,
		apply: () => chain,
	})
	return { oc: chain }
})
const selectQueue: unknown[][] = []

function queryStub<T>(rows: T[]) {
	const stub: Record<string, unknown> = {
		from: jest.fn(() => stub),
		innerJoin: jest.fn(() => stub),
		leftJoin: jest.fn(() => stub),
		where: jest.fn(() => stub),
		orderBy: jest.fn(() => stub),
		groupBy: jest.fn(() => stub),
		having: jest.fn(() => stub),
		limit: jest.fn(() => stub),
		for: jest.fn(() => stub),
		then: (onFulfilled?: (value: T[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(onFulfilled, onRejected),
	}
	return stub
}

jest.mock("@/common/database/database.client", () => ({
	db: {
		select: jest.fn(() => queryStub(selectQueue.shift() ?? [])),
	},
}))

function makeService() {
	selectQueue.length = 0
	const record = jest.fn().mockResolvedValue(undefined)
	const auditService = { record } as unknown as AuditService
	const policyService = { get: jest.fn() } as unknown as PolicyService
	const service = new BookingService(auditService, policyService)
	return { service, record }
}

describe("BookingService own bookings (BKG-4)", () => {
	describe("listOwn (AC 1 & AC 3)", () => {
		it("rejects unauthenticated callers with UNAUTHORIZED (401)", async () => {
			const { service } = makeService()
			await expect(service.listOwn(null)).rejects.toMatchObject({
				code: "UNAUTHORIZED",
				status: 401,
			})
		})

		it("returns an empty list when the client has no bookings", async () => {
			const { service } = makeService()
			selectQueue.push([])
			await expect(service.listOwn("client-1")).resolves.toEqual({ bookings: [] })
		})

		it("returns own bookings newest first with Reference Number, Services, schedule, total, and mapped status", async () => {
			const { service } = makeService()
			const newerCreatedAt = new Date("2026-11-23T09:00:00.000Z")
			const olderCreatedAt = new Date("2026-11-20T09:00:00.000Z")

			selectQueue.push(
				[
					{
						id: 42,
						referenceNumber: "QSPS-261123-NEW123",
						clientId: "client-1",
						status: "paid",
						kind: "regular",
						totalCentavos: 200000,
						holdExpiresAt: null,
						payOnsite: false,
						cancelReason: null,
						cancelledAt: null,
						createdAt: newerCreatedAt,
					},
					{
						id: 31,
						referenceNumber: "QSPS-261120-OLD456",
						clientId: "client-1",
						status: "pending_payment",
						kind: "regular",
						totalCentavos: 150000,
						holdExpiresAt: new Date("2026-11-20T10:00:00.000Z"),
						payOnsite: false,
						cancelReason: null,
						cancelledAt: null,
						createdAt: olderCreatedAt,
					},
				],
				[
					{
						id: 101,
						bookingId: 42,
						serviceId: 1,
						serviceName: "Yellow fever vaccination",
						locationId: 2,
						locationName: "Manila",
						scheduleSlotId: 7,
						startsAt: new Date("2026-12-02T00:00:00.000Z"),
						endsAt: new Date("2026-12-02T04:00:00.000Z"),
						feeCentavos: 150000,
						status: "checked_in",
					},
					{
						id: 102,
						bookingId: 42,
						serviceId: 3,
						serviceName: "Basic hygiene seminar",
						locationId: 2,
						locationName: "Manila",
						scheduleSlotId: 8,
						startsAt: new Date("2026-12-02T05:00:00.000Z"),
						endsAt: new Date("2026-12-02T07:00:00.000Z"),
						feeCentavos: 50000,
						status: "booked",
					},
					{
						id: 90,
						bookingId: 31,
						serviceId: 1,
						serviceName: "Yellow fever vaccination",
						locationId: 2,
						locationName: "Manila",
						scheduleSlotId: 5,
						startsAt: new Date("2026-11-25T00:00:00.000Z"),
						endsAt: new Date("2026-11-25T04:00:00.000Z"),
						feeCentavos: 150000,
						status: "booked",
					},
				]
			)

			const result = await service.listOwn("client-1")

			expect(result.bookings).toHaveLength(2)
			expect(result.bookings[0]).toMatchObject({
				id: 42,
				referenceNumber: "QSPS-261123-NEW123",
				status: "paid",
				clientStatus: "Paid",
				totalCentavos: 200000,
			})
			expect(result.bookings[0]?.items.map(i => i.serviceName)).toEqual([
				"Yellow fever vaccination",
				"Basic hygiene seminar",
			])
			expect(result.bookings[1]).toMatchObject({
				id: 31,
				referenceNumber: "QSPS-261120-OLD456",
				status: "pending_payment",
				clientStatus: "Pending",
				totalCentavos: 150000,
			})
		})

		it("reflects updated booking statuses on subsequent reloads (AC 3)", async () => {
			const { service } = makeService()
			const baseRow = {
				id: 31,
				referenceNumber: "QSPS-261120-OLD456",
				clientId: "client-1",
				status: "pending_payment",
				kind: "regular",
				totalCentavos: 150000,
				holdExpiresAt: null,
				payOnsite: false,
				cancelReason: null,
				cancelledAt: null,
				createdAt: new Date("2026-11-20T09:00:00.000Z"),
			}
			const itemRow = {
				id: 90,
				bookingId: 31,
				serviceId: 1,
				serviceName: "Yellow fever vaccination",
				locationId: 2,
				locationName: "Manila",
				scheduleSlotId: 5,
				startsAt: new Date("2026-11-25T00:00:00.000Z"),
				endsAt: new Date("2026-11-25T04:00:00.000Z"),
				feeCentavos: 150000,
				status: "booked",
			}

			selectQueue.push(
				[baseRow],
				[itemRow],
				[{ ...baseRow, status: "cancelled", cancelReason: "client_cancelled" }],
				[itemRow]
			)

			const first = await service.listOwn("client-1")
			expect(first.bookings[0]?.clientStatus).toBe("Pending")

			const second = await service.listOwn("client-1")
			expect(second.bookings[0]?.clientStatus).toBe("Cancelled")
			expect(selectQueue).toHaveLength(0)
		})
	})

	describe("getOwn (AC 2, AC 3 & AC 4)", () => {
		it("rejects unauthenticated callers with UNAUTHORIZED (401)", async () => {
			const { service } = makeService()
			await expect(service.getOwn(31, null)).rejects.toMatchObject({
				code: "UNAUTHORIZED",
				status: 401,
			})
		})

		it("returns 404 NOT_FOUND and audits denial when requesting another client's booking (AC 4)", async () => {
			const { service, record } = makeService()
			selectQueue.push([
				{
					id: 31,
					referenceNumber: "QSPS-261122-AB12CD",
					clientId: "other-client",
					status: "paid",
				},
			])

			await expect(service.getOwn(31, "client-1")).rejects.toThrow(ORPCError)

			selectQueue.push([
				{
					id: 31,
					referenceNumber: "QSPS-261122-AB12CD",
					clientId: "other-client",
					status: "paid",
				},
			])
			await expect(service.getOwn(31, "client-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
				status: 404,
			})

			expect(record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "bookings",
					action: "booking.read",
					outcome: "denied",
					actorId: "client-1",
					targetType: "booking",
					targetId: "31",
					reason: "not_owner",
				})
			)
		})

		it("returns 404 NOT_FOUND and audits not_found when booking id does not exist", async () => {
			const { service, record } = makeService()
			selectQueue.push([])

			await expect(service.getOwn(999, "client-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
				status: 404,
			})

			expect(record).toHaveBeenCalledWith(
				expect.objectContaining({
					domain: "bookings",
					action: "booking.read",
					outcome: "denied",
					actorId: "client-1",
					targetType: "booking",
					targetId: "999",
					reason: "not_found",
				})
			)
		})

		it("returns full booking details including item processing status, payment, receipt, and issued documents (AC 2)", async () => {
			const { service, record } = makeService()
			const bookingRow = {
				id: 31,
				referenceNumber: "QSPS-261122-AB12CD",
				clientId: "client-1",
				status: "completed",
				kind: "regular",
				totalCentavos: 150000,
				holdExpiresAt: null,
				payOnsite: false,
				cancelReason: null,
				cancelledAt: null,
				createdAt: new Date("2026-11-22T07:00:00.000Z"),
			}

			const itemRows = [
				{
					id: 44,
					serviceId: 1,
					serviceName: "Yellow fever vaccination",
					locationId: 2,
					locationName: "Manila",
					scheduleSlotId: 7,
					startsAt: new Date("2026-12-02T00:00:00.000Z"),
					endsAt: new Date("2026-12-02T04:00:00.000Z"),
					feeCentavos: 150000,
					status: "issued",
				},
			]

			const paymentRows = [
				{
					id: 12,
					amountCentavos: 151500,
					convenienceFeeCentavos: 1500,
					providerCode: "fake",
					channelCode: "gcash",
					channelName: "GCash",
					status: "succeeded",
					paidAt: new Date("2026-11-22T07:05:00.000Z"),
					createdAt: new Date("2026-11-22T07:04:00.000Z"),
				},
			]

			const receiptRows = [
				{
					id: 5,
					paymentId: 12,
					receiptNumber: "QSPS-R-261122-000001",
					verificationToken: "AbCdEfGhIjKlMnOpQrSt_-",
					issuedAt: new Date("2026-11-22T07:05:00.000Z"),
				},
			]

			const documentRows = [
				{
					id: 99,
					bookingItemId: 44,
					documentType: "icv-record",
					documentNumber: "ICV-MNL-2026-000001",
					status: "valid",
					issuedAt: new Date("2026-12-02T01:30:00.000Z"),
					validUntil: null,
				},
			]

			selectQueue.push([bookingRow], [bookingRow], itemRows, paymentRows, receiptRows, documentRows)

			const detail = await service.getOwn(31, "client-1")

			expect(record).not.toHaveBeenCalled()
			expect(detail).toMatchObject({
				id: 31,
				referenceNumber: "QSPS-261122-AB12CD",
				status: "completed",
				clientStatus: "Paid",
				totalCentavos: 150000,
			})
			expect(detail.items[0]?.status).toBe("issued")
			expect(detail.payment).toMatchObject({
				id: 12,
				amountCentavos: 151500,
				convenienceFeeCentavos: 1500,
				channelName: "GCash",
				paidAt: new Date("2026-11-22T07:05:00.000Z"),
				status: "succeeded",
			})
			expect(detail.receipt).toMatchObject({
				id: 5,
				paymentId: 12,
				receiptNumber: "QSPS-R-261122-000001",
			})
			expect(detail.documents).toEqual([
				{
					id: 99,
					bookingItemId: 44,
					serviceName: "Yellow fever vaccination",
					documentType: "icv-record",
					documentNumber: "ICV-MNL-2026-000001",
					status: "valid",
					issuedAt: new Date("2026-12-02T01:30:00.000Z"),
					validUntil: null,
				},
			])
		})
	})
})
