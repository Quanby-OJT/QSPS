import { Logger } from "@nestjs/common"

import { paymentEvents, payments, receipts, refundRequests } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { NotificationService } from "@/common/notifications/notification.service"

import type { BookingService } from "../bookings/bookings.service"
import type { PaymentChannelService } from "./payment-channels.service"
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
			// Awaited directly, or followed by limit().
			orderBy: () => ({
				then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
					Promise.resolve(rows).then(resolve, reject),
				limit: () => Promise.resolve(rows),
			}),
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

/** PAY-2a: what confirm reads for the receipt, in this order. */
const receiptNames = [{ clientName: "Alex Johnson", channelName: "Fake gateway" }]
const receiptLines = [{ serviceName: "Yellow fever vaccination", feeCentavos: 150000 }]

/** A channel with no convenience fee, served by the stub provider. */
const fakeChannel = {
	code: "fake",
	name: "Fake gateway",
	providerCode: "fake",
	convenienceFeeCentavos: 0,
	convenienceFeeBps: 0,
	isEnabled: true,
	createdAt: NOW,
	updatedAt: NOW,
}

describe("PaymentService", () => {
	let audit: { record: jest.Mock }
	let bookingService: { markPaid: jest.Mock }
	let provider: PaymentProvider
	let channels: { findUsable: jest.Mock }
	let alerts: jest.SpyInstance

	/**
	 * The channel the client picked. `findUsable` answers for that one code
	 * only, as the real service does for an enabled channel whose provider
	 * exists; any other code is not available.
	 */
	function makeService(withProvider: PaymentProvider = provider, channel = fakeChannel) {
		channels = {
			findUsable: jest.fn(async (code: string) =>
				code === channel.code ? { channel, provider: withProvider } : undefined
			),
		}
		return new PaymentService(
			audit as unknown as AuditService,
			bookingService as unknown as BookingService,
			new PaymentProviderRegistry([withProvider]),
			channels as unknown as PaymentChannelService
		)
	}

	beforeEach(() => {
		jest.clearAllMocks()
		jest.spyOn(NotificationService, "enqueue").mockResolvedValue(undefined)
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

		it("charges the channel's convenience fee on top of the Service fees", async () => {
			const gcash = {
				...fakeChannel,
				code: "gcash",
				name: "GCash",
				convenienceFeeCentavos: 1500,
				convenienceFeeBps: 250,
			}
			const database = fakeDatabase({
				selects: [[ownBooking], [{ status: "pending_payment" }]],
				inserts: [[{ ...savedPayment, providerReference: null, status: "initiated" }]],
			})

			const result = await makeService(provider, gcash).create(
				{ bookingId: 31, channelCode: "gcash" },
				"client-1",
				NOW
			)

			// PHP 1,500.00 + PHP 15.00 fixed + 2.5% (PHP 37.50) = PHP 1,552.50
			expect(database.inserted[0]?.values).toMatchObject({
				channelCode: "gcash",
				providerCode: "fake",
				convenienceFeeCentavos: 5250,
				amountCentavos: 155250,
			})
			expect(provider.createCheckout).toHaveBeenCalledWith(
				expect.objectContaining({ amountCentavos: 155250 })
			)
			expect(result).toMatchObject({ amountCentavos: 155250, convenienceFeeCentavos: 5250 })
		})

		it("sends the payment to whichever provider the channel is routed to now", async () => {
			const other: PaymentProvider = { ...stubProvider(), code: "other" }
			const database = fakeDatabase({
				selects: [[ownBooking], [{ status: "pending_payment" }]],
				inserts: [[{ ...savedPayment, providerReference: null, status: "initiated" }]],
			})

			await makeService(other, { ...fakeChannel, code: "gcash", providerCode: "other" }).create(
				{ bookingId: 31, channelCode: "gcash" },
				"client-1",
				NOW
			)

			expect(channels.findUsable).toHaveBeenCalledWith("gcash")
			expect(database.inserted[0]?.values).toMatchObject({
				channelCode: "gcash",
				providerCode: "other",
			})
			expect(other.createCheckout).toHaveBeenCalled()
			expect(provider.createCheckout).not.toHaveBeenCalled()
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
				selects: [[{ id: 90, amountCentavos: 150000 }], [savedPayment], receiptNames, receiptLines],
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
			// NTF-1: receipt and booking QR, queued in the confirming transaction.
			expect(NotificationService.enqueue).toHaveBeenCalledWith(
				expect.anything(),
				31,
				"payment_received",
				"payment:90:succeeded",
				{ paymentId: 90 }
			)
		})

		it("issues exactly one e-Receipt in the confirming transaction", async () => {
			const database = fakeDatabase({
				selects: [[{ id: 90, amountCentavos: 150000 }], [savedPayment], receiptNames, receiptLines],
				inserts: [[{ id: 500 }], [{ id: 7, receiptNumber: "QSPS-R-261117-000090" }]],
			})

			await makeService().handleNotification("fake", notification, NOW)

			expect(database.inserted[1]).toEqual({
				table: receipts,
				values: {
					paymentId: 90,
					receiptNumber: "QSPS-R-261117-000090",
					verificationToken: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
					clientName: "Alex Johnson",
					channelName: "Fake gateway",
					serviceLines: receiptLines,
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
			// [] = no other succeeded payment: a late payment, not a duplicate.
			const database = fakeDatabase({ selects: [[savedPayment], [], receiptNames, receiptLines] })
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
			// NTF-1: the receipt email, but not the "booking paid" one with the QR.
			expect(NotificationService.enqueue).toHaveBeenCalledWith(
				expect.anything(),
				31,
				"payment_received_review",
				"payment:90:succeeded",
				{ paymentId: 90 }
			)
			expect(NotificationService.enqueue).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.anything(),
				"payment_received",
				expect.anything(),
				expect.anything()
			)
		})

		it("stores the channel code on the receipt when the channel has no row (PAY-2a)", async () => {
			const database = fakeDatabase({
				selects: [
					[savedPayment],
					[{ clientName: "Alex Johnson", channelName: null }],
					receiptLines,
				],
				inserts: [[{ id: 7, receiptNumber: "QSPS-R-261117-000090" }]],
			})

			await makeService().confirm(90, { actorId: null }, NOW)

			expect(database.inserted[0]?.values).toMatchObject({
				clientName: "Alex Johnson",
				channelName: "fake",
				serviceLines: receiptLines,
			})
		})
		it("queues no email when the payment had already succeeded", async () => {
			fakeDatabase({ selects: [[{ ...savedPayment, status: "succeeded" }]] })

			await makeService().confirm(90, { actorId: null }, NOW)

			expect(NotificationService.enqueue).not.toHaveBeenCalled()
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

	describe("collectOnsite (PAY-4)", () => {
		const onsiteProvider: PaymentProvider = {
			code: "onsite",
			createCheckout: jest.fn().mockResolvedValue({
				providerReference: "onsite_91_aaaaaaaaaaaa",
				checkoutUrl: "http://localhost:3001/cashier",
			}),
			parseNotification: jest.fn(),
			queryStatus: jest.fn(),
		}
		const collect = {
			bookingId: 31,
			tenderType: "cash" as const,
			amountDueCentavos: 150000,
			amountReceivedCentavos: 200000,
		}
		const onsitePayment = {
			...savedPayment,
			id: 91,
			channelCode: "onsite",
			providerCode: "onsite",
			providerReference: "onsite_91_aaaaaaaaaaaa",
			collectedBy: "cashier-1",
			tenderType: "cash",
		}

		function makeCashierService() {
			return new PaymentService(
				audit as unknown as AuditService,
				bookingService as unknown as BookingService,
				new PaymentProviderRegistry([provider, onsiteProvider]),
				{ findUsable: jest.fn() } as unknown as PaymentChannelService
			)
		}

		it("creates an onsite payment by the cashier and confirms it in the same transaction", async () => {
			const database = fakeDatabase({
				selects: [
					[ownBooking],
					[onsitePayment],
					[{ clientName: "Sam Rivera", channelName: null }],
					receiptLines,
				],
				inserts: [[{ id: 91 }], [{ id: 8, receiptNumber: "QSPS-R-261117-000091" }]],
			})

			const result = await makeCashierService().collectOnsite(collect, "cashier-1", NOW)

			expect(result).toEqual({
				paymentId: 91,
				receiptNumber: "QSPS-R-261117-000091",
				amountCentavos: 150000,
				changeCentavos: 50000,
				bookingStatus: "paid",
			})
			// The booking is locked first, then the new payment.
			expect(database.locks).toEqual(["update", "update"])
			expect(database.inserted[0]).toEqual({
				table: payments,
				values: expect.objectContaining({
					bookingId: 31,
					channelCode: "onsite",
					providerCode: "onsite",
					amountCentavos: 150000,
					convenienceFeeCentavos: 0,
					collectedBy: "cashier-1",
					tenderType: "cash",
				}),
			})
			// Goes through the same confirm as online payments: booking paid, receipt issued.
			expect(bookingService.markPaid).toHaveBeenCalledWith(expect.anything(), 31, "cashier-1", NOW)
			expect(database.updated).toContainEqual({
				table: payments,
				values: { status: "succeeded", needsReview: false, updatedAt: NOW },
			})
			expect(database.inserted[1]).toMatchObject({
				table: receipts,
				values: { clientName: "Sam Rivera", channelName: "Onsite cashier - Cash" },
			})
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "payment.collect_onsite",
					actorId: "cashier-1",
					newValue: expect.objectContaining({
						tenderType: "cash",
						amountReceivedCentavos: 200000,
						changeCentavos: 50000,
						collectedBy: "cashier-1",
					}),
				}),
				expect.anything()
			)
		})

		it("refuses a booking that is already paid and says so", async () => {
			const database = fakeDatabase({ selects: [[{ ...ownBooking, status: "paid" }]] })

			const error = await makeCashierService()
				.collectOnsite(collect, "cashier-1", NOW)
				.catch((caught: unknown) => caught)

			expect(error).toMatchObject({ code: "CONFLICT" })
			expect(String((error as Error).message)).toContain("it is paid")
			expect(database.inserted).toEqual([])
			expect(bookingService.markPaid).not.toHaveBeenCalled()
		})

		it("refuses a cancelled booking", async () => {
			fakeDatabase({ selects: [[{ ...ownBooking, status: "cancelled" }]] })

			await expect(makeCashierService().collectOnsite(collect, "cashier-1", NOW)).rejects.toThrow(
				"it is cancelled"
			)
		})

		it("refuses when the amount due changed since the cashier opened the booking", async () => {
			const database = fakeDatabase({ selects: [[{ ...ownBooking, totalCentavos: 180000 }]] })

			await expect(
				makeCashierService().collectOnsite(collect, "cashier-1", NOW)
			).rejects.toMatchObject({ code: "CONFLICT" })
			expect(database.inserted).toEqual([])
		})

		it("answers 404 for a booking that does not exist", async () => {
			fakeDatabase({ selects: [[]] })

			await expect(
				makeCashierService().collectOnsite(collect, "cashier-1", NOW)
			).rejects.toMatchObject({ code: "NOT_FOUND" })
		})
	})

	describe("duplicate payments (PAY-6)", () => {
		it("records a second success on a paid booking as a duplicate, with no second receipt", async () => {
			// [{ id: 88 }] = the booking was already paid by payment 88.
			const database = fakeDatabase({ selects: [[savedPayment], [{ id: 88 }]] })
			bookingService.markPaid.mockResolvedValue(false)

			const result = await makeService().confirm(90, { actorId: null }, NOW)

			expect(result).toEqual({ alreadyConfirmed: false, needsReview: true })
			expect(database.updated).toEqual([
				{ table: payments, values: { status: "succeeded", needsReview: true, updatedAt: NOW } },
			])
			expect(database.inserted).toEqual([])
			expect(audit.record).not.toHaveBeenCalledWith(
				expect.objectContaining({ action: "receipt.issue" }),
				expect.anything()
			)
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "payment.succeeded",
					newValue: expect.objectContaining({ needsReview: true, reviewReason: "duplicate" }),
				}),
				expect.anything()
			)
			// The client is told BOQ will contact them; no receipt is attached.
			expect(NotificationService.enqueue).toHaveBeenCalledWith(
				expect.anything(),
				31,
				"payment_duplicate_review",
				"payment:90:succeeded",
				{ paymentId: 90 }
			)
			expect(alerts).toHaveBeenCalledWith(expect.objectContaining({ reason: "duplicate_payment" }))
		})
	})

	describe("reconcilePending (PAY-6)", () => {
		const due = [{ id: 90, providerCode: "fake", providerReference: "fake_90_abc", amountCentavos: 150000 }]

		it("confirms a payment the provider says was paid, through confirm", async () => {
			const database = fakeDatabase({
				selects: [due, [savedPayment], receiptNames, receiptLines],
				inserts: [[{ id: 7, receiptNumber: "QSPS-R-261117-000090" }]],
			})
			;(provider.queryStatus as jest.Mock).mockResolvedValue({ status: "succeeded", amountCentavos: 150000 })

			const result = await makeService().reconcilePending(NOW)

			expect(provider.queryStatus).toHaveBeenCalledWith("fake_90_abc")
			expect(result).toMatchObject({ checked: 1, confirmed: 1, failed: 0 })
			expect(bookingService.markPaid).toHaveBeenCalledWith(expect.anything(), 31, null, NOW)
			expect(database.updated).toContainEqual({
				table: payments,
				values: { status: "succeeded", needsReview: false, updatedAt: NOW },
			})
		})

		it("marks a payment expired when the provider says so", async () => {
			const database = fakeDatabase({ selects: [due, [{ status: "pending" }]] })
			;(provider.queryStatus as jest.Mock).mockResolvedValue({ status: "expired", amountCentavos: null })

			const result = await makeService().reconcilePending(NOW)

			expect(result).toMatchObject({ checked: 1, closed: 1 })
			expect(database.updated).toEqual([{ table: payments, values: { status: "expired", updatedAt: NOW } }])
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "payment.expired", actorId: null }),
				expect.anything()
			)
		})

		it("marks a payment failed when the provider says so", async () => {
			const database = fakeDatabase({ selects: [due, [{ status: "pending" }]] })
			;(provider.queryStatus as jest.Mock).mockResolvedValue({ status: "failed", amountCentavos: null })

			await makeService().reconcilePending(NOW)

			expect(database.updated).toEqual([{ table: payments, values: { status: "failed", updatedAt: NOW } }])
		})

		it("touches a payment the provider still reports pending, so it is asked again later", async () => {
			const database = fakeDatabase({ selects: [due] })
			;(provider.queryStatus as jest.Mock).mockResolvedValue({ status: "pending", amountCentavos: null })

			const result = await makeService().reconcilePending(NOW)

			expect(result).toMatchObject({ checked: 1, stillPending: 1 })
			expect(database.updated).toEqual([{ table: payments, values: { updatedAt: NOW } }])
			expect(bookingService.markPaid).not.toHaveBeenCalled()
		})

		it("changes nothing for a success with a different amount, and alerts", async () => {
			const database = fakeDatabase({ selects: [due] })
			;(provider.queryStatus as jest.Mock).mockResolvedValue({ status: "succeeded", amountCentavos: 100 })

			const result = await makeService().reconcilePending(NOW)

			expect(result).toMatchObject({ amountMismatch: 1, confirmed: 0 })
			expect(bookingService.markPaid).not.toHaveBeenCalled()
			expect(database.updated).toEqual([{ table: payments, values: { updatedAt: NOW } }])
			expect(alerts).toHaveBeenCalledWith(expect.objectContaining({ reason: "amount_mismatch", source: "requery" }))
		})

		it("keeps going when one provider cannot be reached", async () => {
			const second = { ...due[0], id: 91, providerReference: "fake_91_def" }
			fakeDatabase({ selects: [[...due, second]] })
			;(provider.queryStatus as jest.Mock)
				.mockRejectedValueOnce(new Error("gateway timeout"))
				.mockResolvedValueOnce({ status: "pending", amountCentavos: null })

			const result = await makeService().reconcilePending(NOW)

			expect(result).toMatchObject({ failed: 1, stillPending: 1 })
			expect(provider.queryStatus).toHaveBeenCalledTimes(2)
		})

		it("does nothing when no payment is due", async () => {
			fakeDatabase({ selects: [[]] })

			await expect(makeService().reconcilePending(NOW)).resolves.toEqual({
				checked: 0,
				confirmed: 0,
				closed: 0,
				stillPending: 0,
				amountMismatch: 0,
				failed: 0,
			})
		})
	})

	describe("resolveReview (PAY-6)", () => {
		const flagged = {
			id: 92,
			bookingId: 31,
			status: "succeeded",
			needsReview: true,
			reviewResolution: null,
		}

		it("opens a Refund Request and records the resolution, audited without the note", async () => {
			const database = fakeDatabase({ selects: [[flagged]], inserts: [[{ id: 5 }]] })

			const result = await makeService().resolveReview(
				{ paymentId: 92, resolution: "refund_requested", note: "Paid twice; return payment 92" },
				"staff-1",
				NOW
			)

			expect(result).toEqual({ paymentId: 92, resolution: "refund_requested", refundRequestId: 5 })
			expect(database.inserted[0]).toEqual({
				table: refundRequests,
				values: expect.objectContaining({
					bookingId: 31,
					paymentId: 92,
					kind: "refund",
					status: "requested",
					reason: "Paid twice; return payment 92",
					requestedBy: "staff-1",
				}),
			})
			expect(database.updated).toEqual([
				{
					table: payments,
					values: {
						reviewResolution: "refund_requested",
						reviewNote: "Paid twice; return payment 92",
						rebookedBookingId: null,
						reviewedBy: "staff-1",
						reviewedAt: NOW,
						updatedAt: NOW,
					},
				},
			])
			const [entry] = audit.record.mock.calls.at(-1) as [Record<string, unknown>]
			expect(entry).toMatchObject({
				action: "payment.review.resolve",
				actorId: "staff-1",
				newValue: { reviewResolution: "refund_requested", bookingId: 31, refundRequestId: 5 },
			})
			expect(JSON.stringify(entry)).not.toContain("Paid twice")
		})

		it("records a rebooking against the new booking of the same client", async () => {
			const database = fakeDatabase({
				selects: [[flagged], [{ clientId: "client-1" }], [{ id: 40, clientId: "client-1" }]],
			})

			await makeService().resolveReview(
				{
					paymentId: 92,
					resolution: "rebooked",
					note: "Gave a new slot on Dec 2",
					rebookedReferenceNumber: "QSPS-261124-ZZ99YY",
				},
				"staff-1",
				NOW
			)

			expect(database.inserted).toEqual([])
			expect(database.updated[0]?.values).toMatchObject({ reviewResolution: "rebooked", rebookedBookingId: 40 })
		})

		it("refuses a rebooking that names another client's booking", async () => {
			const database = fakeDatabase({
				selects: [[flagged], [{ clientId: "client-1" }], [{ id: 40, clientId: "client-2" }]],
			})

			await expect(
				makeService().resolveReview(
					{ paymentId: 92, resolution: "rebooked", note: "New slot", rebookedReferenceNumber: "QSPS-261124-ZZ99YY" },
					"staff-1",
					NOW
				)
			).rejects.toMatchObject({ code: "BAD_REQUEST" })
			expect(database.updated).toEqual([])
		})

		it("refuses to resolve the same payment twice", async () => {
			fakeDatabase({ selects: [[{ ...flagged, reviewResolution: "rebooked" }]] })

			await expect(
				makeService().resolveReview(
					{ paymentId: 92, resolution: "refund_requested", note: "Again" },
					"staff-1",
					NOW
				)
			).rejects.toMatchObject({ code: "CONFLICT" })
		})

		it("refuses a payment that does not need review", async () => {
			fakeDatabase({ selects: [[{ ...flagged, needsReview: false }]] })

			await expect(
				makeService().resolveReview(
					{ paymentId: 92, resolution: "refund_requested", note: "Nothing to do" },
					"staff-1",
					NOW
				)
			).rejects.toMatchObject({ code: "CONFLICT" })
		})
	})
})
