import { Logger } from "@nestjs/common"

import { paymentEvents, payments, receipts } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import type { BookingService } from "../bookings/bookings.service"
import { PaymentService } from "./payments.service"
import type { ParsedNotification, PaymentProvider } from "./providers/payment-provider"
import { PaymentProviderRegistry } from "./providers/provider-registry"

// ADM-6: BookingService now reads PolicyService, which loads @repo/contracts
// (and the ESM-only @orpc/contract). This spec does not test policies.
jest.mock("@/common/policy/policy.service", () => ({
	PolicyService: jest.fn(),
}))

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
	db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), transaction: jest.fn() },
}))

jest.mock("@/config/env.config", () => ({
	env: {
		NODE_ENV: "test",
		FAKE_PAYMENT_SECRET: "test-secret",
		APP_WEB_URL: "http://localhost:3001",
		PAYMENT_NOTIFY_BASE_URL: "http://localhost:3000/api",
	},
}))

const NOW = new Date("2026-11-17T07:00:00.000Z")

/**
 * A stand-in for the database. Each `select` resolves to the next entry in
 * `selects`, each `insert` to the next entry in `inserts`. Writes are
 * recorded so tests can check exactly what changed. `transaction` runs the
 * callback with the same object, so code inside and outside a transaction
 * reads from the same queues.
 */
function fakeDatabase(options: { selects?: unknown[][]; inserts?: unknown[][] }) {
	const selects = [...(options.selects ?? [])]
	const inserts = [...(options.inserts ?? [])]
	const inserted: { table: unknown; values: Record<string, unknown> }[] = []
	const updated: { table: unknown; values: Record<string, unknown> }[] = []
	const locks: string[] = []

	const select = () => {
		const rows = selects.shift() ?? []
		const chain: Record<string, unknown> = {
			from: () => chain,
			innerJoin: () => chain,
			leftJoin: () => chain,
			where: () => chain,
			limit: () => Promise.resolve(rows),
			for: (mode: string) => {
				locks.push(mode)
				return Promise.resolve(rows)
			},
		}
		return chain
	}
	const insert = (table: unknown) => ({
		values: (values: Record<string, unknown>) => {
			inserted.push({ table, values })
			const rows = inserts.shift() ?? []
			return {
				returning: () => Promise.resolve(rows),
				onConflictDoNothing: () => ({ returning: () => Promise.resolve(rows) }),
			}
		},
	})
	const update = (table: unknown) => ({
		set: (values: Record<string, unknown>) => {
			updated.push({ table, values })
			return { where: () => Promise.resolve() }
		},
	})

	const handle = { select, insert, update }
	const mocked = db as unknown as Record<"select" | "insert" | "update" | "transaction", jest.Mock>
	mocked.select.mockImplementation(select)
	mocked.insert.mockImplementation(insert)
	mocked.update.mockImplementation(update)
	mocked.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(handle))

	return { inserted, updated, locks }
}

function stubProvider(parsed?: Partial<ParsedNotification>): PaymentProvider {
	return {
		code: "fake",
		createCheckout: jest.fn().mockResolvedValue({
			providerReference: "fake_90_abc",
			checkoutUrl: "http://localhost:3001/payments/return?paymentId=90",
		}),
		parseNotification: jest.fn().mockReturnValue({
			eventId: "evt-1",
			providerReference: "fake_90_abc",
			status: "succeeded",
			amountCentavos: 150000,
			signatureValid: true,
			payload: { any: "body" },
			...parsed,
		}),
		queryStatus: jest.fn(),
	}
}

const ownBooking = {
	id: 31,
	clientId: "client-1",
	status: "pending_payment",
	referenceNumber: "QSPS-261117-AB12CD",
	totalCentavos: 150000,
}

const savedPayment = {
	id: 90,
	bookingId: 31,
	channelCode: "fake",
	providerCode: "fake",
	providerReference: "fake_90_abc",
	amountCentavos: 150000,
	convenienceFeeCentavos: 0,
	status: "pending",
	needsReview: false,
	collectedBy: null,
	createdAt: NOW,
	updatedAt: NOW,
}

const notification = { headers: {}, rawBody: '{"any":"body"}' }

describe("PaymentService", () => {
	let audit: { record: jest.Mock }
	let bookingService: { markPaid: jest.Mock }
	let provider: PaymentProvider
	let alerts: jest.SpyInstance

	function makeService(withProvider: PaymentProvider = provider) {
		return new PaymentService(
			audit as unknown as AuditService,
			bookingService as unknown as BookingService,
			new PaymentProviderRegistry([withProvider])
		)
	}

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		bookingService = { markPaid: jest.fn().mockResolvedValue(true) }
		provider = stubProvider()
		alerts = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined)
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined)
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
	})

	describe("create", () => {
		it("creates an initiated payment and sends the client to checkout for the exact total", async () => {
			const database = fakeDatabase({
				selects: [[ownBooking], [{ status: "pending_payment" }]],
				inserts: [[{ ...savedPayment, providerReference: null, status: "initiated" }]],
			})

			const result = await makeService().create(
				{ bookingId: 31, channelCode: "fake" },
				"client-1",
				NOW
			)

			expect(database.inserted[0]).toEqual({
				table: payments,
				values: expect.objectContaining({
					bookingId: 31,
					providerCode: "fake",
					amountCentavos: 150000,
					convenienceFeeCentavos: 0,
					status: "initiated",
				}),
			})
			expect(provider.createCheckout).toHaveBeenCalledWith(
				expect.objectContaining({
					paymentId: 90,
					amountCentavos: 150000,
					returnUrl: "http://localhost:3001/payments/return?paymentId=90",
					notifyUrl: "http://localhost:3000/api/v1/payments/notifications/fake",
				})
			)
			expect(database.updated).toEqual([
				{
					table: payments,
					values: { providerReference: "fake_90_abc", status: "pending", updatedAt: NOW },
				},
			])
			expect(result).toEqual({
				paymentId: 90,
				status: "pending",
				amountCentavos: 150000,
				convenienceFeeCentavos: 0,
				checkoutUrl: "http://localhost:3001/payments/return?paymentId=90",
			})
			expect(audit.record.mock.calls.map(([event]) => event.action)).toEqual([
				"payment.create",
				"payment.checkout",
			])
			// The booking is never marked paid here; only a verified notification does that.
			expect(bookingService.markPaid).not.toHaveBeenCalled()
		})

		it("answers 404 and audits a denial when the booking is someone else's", async () => {
			const database = fakeDatabase({ selects: [[ownBooking]] })

			await expect(
				makeService().create({ bookingId: 31, channelCode: "fake" }, "client-2", NOW)
			).rejects.toMatchObject({ code: "NOT_FOUND" })

			expect(database.inserted).toEqual([])
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "payment.create",
					outcome: "denied",
					actorId: "client-2",
					targetId: "31",
					reason: "not_owner",
				})
			)
		})

		it("answers 404 and audits a denial when the booking does not exist", async () => {
			fakeDatabase({ selects: [[]] })

			await expect(
				makeService().create({ bookingId: 404, channelCode: "fake" }, "client-1", NOW)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", reason: "not_found" })
			)
		})

		it("refuses a booking that is not awaiting payment", async () => {
			fakeDatabase({ selects: [[{ ...ownBooking, status: "paid" }]] })

			await expect(
				makeService().create({ bookingId: 31, channelCode: "fake" }, "client-1", NOW)
			).rejects.toMatchObject({ code: "CONFLICT" })
		})

		it("refuses a channel this deployment does not have", async () => {
			fakeDatabase({})

			await expect(
				makeService().create({ bookingId: 31, channelCode: "gcash" }, "client-1", NOW)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
		})

		it("refuses a caller with no session", async () => {
			await expect(
				makeService().create({ bookingId: 31, channelCode: "fake" }, null, NOW)
			).rejects.toMatchObject({ code: "UNAUTHORIZED" })
		})

		it("marks the payment failed when the provider cannot be reached", async () => {
			const database = fakeDatabase({
				selects: [[ownBooking], [{ status: "pending_payment" }], [{ status: "initiated" }]],
				inserts: [[{ ...savedPayment, status: "initiated" }]],
			})
			;(provider.createCheckout as jest.Mock).mockRejectedValue(new Error("timeout"))

			await expect(
				makeService().create({ bookingId: 31, channelCode: "fake" }, "client-1", NOW)
			).rejects.toMatchObject({ code: "BAD_GATEWAY" })
			expect(database.updated).toEqual([
				{ table: payments, values: { status: "failed", updatedAt: NOW } },
			])
		})
	})

	describe("handleNotification", () => {
		it("stores the event, then marks the payment succeeded and the booking paid", async () => {
			const database = fakeDatabase({
				selects: [[{ id: 90, amountCentavos: 150000 }], [savedPayment]],
				inserts: [[{ id: 500 }]],
			})

			const outcome = await makeService().handleNotification("fake", notification, NOW)

			expect(outcome).toBe("processed")
			expect(database.inserted[0]).toEqual({
				table: paymentEvents,
				values: expect.objectContaining({
					paymentId: 90,
					providerCode: "fake",
					providerEventId: "evt-1",
					signatureValid: true,
				}),
			})
			expect(bookingService.markPaid).toHaveBeenCalledWith(expect.anything(), 31, null, NOW)
			expect(database.updated).toEqual([
				{ table: payments, values: { status: "succeeded", needsReview: false, updatedAt: NOW } },
				{ table: paymentEvents, values: { processedAt: NOW } },
			])
			expect(database.locks).toEqual(["update"])
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "payment.succeeded", targetId: "90" }),
				expect.anything()
			)
		})

		it("issues exactly one e-Receipt in the confirming transaction", async () => {
			const database = fakeDatabase({
				selects: [[{ id: 90, amountCentavos: 150000 }], [savedPayment]],
				inserts: [[{ id: 500 }], [{ id: 7, receiptNumber: "QSPS-R-261117-000090" }]],
			})

			await makeService().handleNotification("fake", notification, NOW)

			expect(database.inserted[1]).toEqual({
				table: receipts,
				values: {
					paymentId: 90,
					receiptNumber: "QSPS-R-261117-000090",
					verificationToken: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
					issuedAt: NOW,
				},
			})
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "receipt.issue",
					targetId: "7",
					newValue: { paymentId: 90, receiptNumber: "QSPS-R-261117-000090" },
				}),
				expect.anything()
			)
		})

		it("does nothing the second time the same notification arrives", async () => {
			// The unique (provider_code, provider_event_id) index turns the insert into a no-op.
			const database = fakeDatabase({
				selects: [[{ id: 90, amountCentavos: 150000 }]],
				inserts: [[]],
			})

			const outcome = await makeService().handleNotification("fake", notification, NOW)

			expect(outcome).toBe("duplicate")
			expect(database.updated).toEqual([])
			expect(bookingService.markPaid).not.toHaveBeenCalled()
		})

		it("still refuses a resent notification with a bad signature, so the gateway keeps retrying", async () => {
			const database = fakeDatabase({
				selects: [[{ id: 90, amountCentavos: 150000 }]],
				inserts: [[]],
			})

			const outcome = await makeService(stubProvider({ signatureValid: false })).handleNotification(
				"fake",
				notification,
				NOW
			)

			expect(outcome).toBe("invalid_signature")
			expect(database.updated).toEqual([])
			expect(bookingService.markPaid).not.toHaveBeenCalled()
		})

		it("keeps a notification with a bad signature, changes nothing, and alerts", async () => {
			const database = fakeDatabase({
				selects: [[{ id: 90, amountCentavos: 150000 }]],
				inserts: [[{ id: 501 }]],
			})

			const outcome = await makeService(stubProvider({ signatureValid: false })).handleNotification(
				"fake",
				notification,
				NOW
			)

			expect(outcome).toBe("invalid_signature")
			expect(database.inserted[0]?.values).toMatchObject({
				signatureValid: false,
				providerEventId: expect.stringMatching(/^unverified:[0-9a-f]{64}$/),
			})
			expect(database.updated).toEqual([])
			expect(bookingService.markPaid).not.toHaveBeenCalled()
			expect(alerts).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "payments.notification.alert",
					reason: "invalid_signature",
				})
			)
		})

		it("keeps a notification for the wrong amount, changes nothing, and alerts", async () => {
			const database = fakeDatabase({
				selects: [[{ id: 90, amountCentavos: 150000 }]],
				inserts: [[{ id: 502 }]],
			})

			const outcome = await makeService(stubProvider({ amountCentavos: 100 })).handleNotification(
				"fake",
				notification,
				NOW
			)

			expect(outcome).toBe("ignored")
			expect(database.inserted).toHaveLength(1)
			expect(database.updated).toEqual([])
			expect(bookingService.markPaid).not.toHaveBeenCalled()
			expect(alerts).toHaveBeenCalledWith(expect.objectContaining({ reason: "amount_mismatch" }))
		})

		it("keeps a notification for a payment it does not know, and alerts", async () => {
			const database = fakeDatabase({ selects: [[]], inserts: [[{ id: 503 }]] })

			const outcome = await makeService().handleNotification("fake", notification, NOW)

			expect(outcome).toBe("ignored")
			expect(database.inserted[0]?.values).toMatchObject({ paymentId: null })
			expect(alerts).toHaveBeenCalledWith(expect.objectContaining({ reason: "unknown_reference" }))
		})

		it("rejects a provider code this deployment does not have, storing nothing", async () => {
			const database = fakeDatabase({})

			const outcome = await makeService().handleNotification("nope", notification, NOW)

			expect(outcome).toBe("unknown_provider")
			expect(database.inserted).toEqual([])
		})

		it("marks the payment failed when the provider reports a failure", async () => {
			const database = fakeDatabase({
				selects: [[{ id: 90, amountCentavos: 150000 }], [{ status: "pending" }]],
				inserts: [[{ id: 504 }]],
			})

			const outcome = await makeService(stubProvider({ status: "failed" })).handleNotification(
				"fake",
				notification,
				NOW
			)

			expect(outcome).toBe("processed")
			expect(database.updated).toEqual([
				{ table: payments, values: { status: "failed", updatedAt: NOW } },
				{ table: paymentEvents, values: { processedAt: NOW } },
			])
			expect(bookingService.markPaid).not.toHaveBeenCalled()
		})
	})

	describe("confirm", () => {
		it("returns without changing anything when the payment already succeeded", async () => {
			const database = fakeDatabase({ selects: [[{ ...savedPayment, status: "succeeded" }]] })

			const result = await makeService().confirm(90, { actorId: null }, NOW)

			expect(result).toEqual({ alreadyConfirmed: true, needsReview: false })
			expect(bookingService.markPaid).not.toHaveBeenCalled()
			expect(database.updated).toEqual([])
			// No second receipt for a payment that was already confirmed.
			expect(database.inserted).toEqual([])
		})

		it("records late money on a cancelled booking and flags it for review", async () => {
			const database = fakeDatabase({ selects: [[savedPayment]] })
			bookingService.markPaid.mockResolvedValue(false)

			const result = await makeService().confirm(90, { actorId: null }, NOW)

			expect(result).toEqual({ alreadyConfirmed: false, needsReview: true })
			expect(database.updated).toEqual([
				{ table: payments, values: { status: "succeeded", needsReview: true, updatedAt: NOW } },
			])
			expect(alerts).toHaveBeenCalledWith(
				expect.objectContaining({ reason: "paid_unpayable_booking" })
			)
			// The money arrived, so the client still gets proof of payment.
			expect(database.inserted.map(entry => entry.table)).toEqual([receipts])
		})

		it("refuses to confirm a refunded payment", async () => {
			fakeDatabase({ selects: [[{ ...savedPayment, status: "refunded" }]] })

			await expect(makeService().confirm(90, { actorId: null }, NOW)).rejects.toMatchObject({
				code: "CONFLICT",
			})
		})
	})

	describe("getStatus", () => {
		const row = {
			paymentId: 90,
			bookingId: 31,
			status: "pending",
			amountCentavos: 150000,
			clientId: "client-1",
			referenceNumber: "QSPS-261117-AB12CD",
			bookingStatus: "pending_payment",
		}

		it("shows the owner their payment", async () => {
			fakeDatabase({ selects: [[row]] })

			await expect(makeService().getStatus(90, "client-1")).resolves.toEqual({
				paymentId: 90,
				bookingId: 31,
				referenceNumber: "QSPS-261117-AB12CD",
				status: "pending",
				bookingStatus: "pending_payment",
				amountCentavos: 150000,
				receiptNumber: null,
			})
		})

		it("answers 404 and audits a denial for someone else's payment", async () => {
			fakeDatabase({ selects: [[row]] })

			await expect(makeService().getStatus(90, "client-2")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "payment.read", outcome: "denied", reason: "not_owner" })
			)
		})
	})
})
