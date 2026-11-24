import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { PaymentChannelService } from "./payment-channels.service"
import type { PaymentProvider } from "./providers/payment-provider"
import { PaymentProviderRegistry } from "./providers/provider-registry"

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
	db: { select: jest.fn(), update: jest.fn(), transaction: jest.fn() },
}))
jest.mock("@/config/env.config", () => ({
	env: { NODE_ENV: "test", PAYMENT_FAKE_ENABLED: true, FAKE_PAYMENT_SECRET: "test-secret" },
}))

const NOW = new Date("2026-11-18T02:00:00.000Z")

function channelRow(overrides: Record<string, unknown> = {}) {
	return {
		code: "gcash",
		name: "GCash",
		providerCode: "fake",
		convenienceFeeCentavos: 1500,
		convenienceFeeBps: 0,
		isEnabled: true,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	}
}

/**
 * Each `select` resolves to the next entry, however the query ends; writes
 * are recorded. `transaction` runs the callback with the same object.
 */
function fakeDatabase(selects: unknown[][], updateReturns: unknown[] = []) {
	const queue = [...selects]
	const updates: Record<string, unknown>[] = []
	const select = () => {
		const rows = queue.shift() ?? []
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: () => chain,
			orderBy: () => Promise.resolve(rows),
			limit: () => Promise.resolve(rows),
			for: () => Promise.resolve(rows),
		}
		return chain
	}
	const update = () => ({
		set: (values: Record<string, unknown>) => {
			updates.push(values)
			return { where: () => ({ returning: () => Promise.resolve(updateReturns) }) }
		},
	})
	const handle = { select, update }
	const mocked = db as unknown as Record<"select" | "update" | "transaction", jest.Mock>
	mocked.select.mockImplementation(select)
	mocked.update.mockImplementation(update)
	mocked.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(handle))
	return { updates }
}

function provider(code: string): PaymentProvider {
	return { code, createCheckout: jest.fn(), parseNotification: jest.fn(), queryStatus: jest.fn() }
}

describe("PaymentChannelService", () => {
	let audit: { record: jest.Mock }
	let service: PaymentChannelService

	beforeEach(() => {
		jest.clearAllMocks()
		audit = { record: jest.fn().mockResolvedValue(undefined) }
		service = new PaymentChannelService(
			audit as unknown as AuditService,
			new PaymentProviderRegistry([provider("fake"), provider("linkbiz"), provider("onsite")])
		)
	})

	describe("listForSettings", () => {
		it("returns every channel and the providers this deployment has", async () => {
			fakeDatabase([[channelRow(), channelRow({ code: "maya", name: "Maya", providerCode: null, isEnabled: false })]])

			await expect(service.listForSettings()).resolves.toEqual({
				channels: [
					{ code: "gcash", name: "GCash", providerCode: "fake", convenienceFeeCentavos: 1500, convenienceFeeBps: 0, isEnabled: true },
					{ code: "maya", name: "Maya", providerCode: null, convenienceFeeCentavos: 1500, convenienceFeeBps: 0, isEnabled: false },
				],
				providerCodes: ["fake", "linkbiz"],
			})
		})
	})

	describe("update", () => {
		const input = {
			code: "gcash",
			name: "GCash",
			providerCode: "linkbiz",
			convenienceFeeCentavos: 2000,
			convenienceFeeBps: 150,
			isEnabled: true,
		}

		it("switches the provider and fee, and audits old and new values", async () => {
			const current = channelRow()
			const updated = channelRow({ providerCode: "linkbiz", convenienceFeeCentavos: 2000, convenienceFeeBps: 150 })
			const database = fakeDatabase([[current]], [updated])

			await expect(service.update(input, "admin-1")).resolves.toMatchObject({
				code: "gcash",
				providerCode: "linkbiz",
				convenienceFeeCentavos: 2000,
				convenienceFeeBps: 150,
			})
			expect(database.updates[0]).toMatchObject({
				providerCode: "linkbiz",
				convenienceFeeCentavos: 2000,
				convenienceFeeBps: 150,
				isEnabled: true,
			})
			expect(audit.record).toHaveBeenCalledWith(
				{
					domain: "payments",
					action: "payment_channel.fee.update",
					actorId: "admin-1",
					targetType: "payment_channel",
					targetId: "gcash",
					oldValue: { name: "GCash", providerCode: "fake", convenienceFeeCentavos: 1500, convenienceFeeBps: 0, isEnabled: true },
					newValue: { name: "GCash", providerCode: "linkbiz", convenienceFeeCentavos: 2000, convenienceFeeBps: 150, isEnabled: true },
				},
				expect.anything()
			)
		})

		it("names a change that leaves the fee alone as a plain update", async () => {
			fakeDatabase([[channelRow()]], [channelRow({ isEnabled: false })])

			await service.update(
				{ ...input, providerCode: "fake", convenienceFeeCentavos: 1500, convenienceFeeBps: 0, isEnabled: false },
				"admin-1"
			)

			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ action: "payment_channel.update" }),
				expect.anything()
			)
		})

		it("refuses a provider this deployment does not have", async () => {
			fakeDatabase([])

			await expect(service.update({ ...input, providerCode: "gcash-direct" }, "admin-1")).rejects.toMatchObject({
				code: "BAD_REQUEST",
			})
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("refuses the onsite cashier provider: it has no checkout page (PAY-4)", async () => {
			fakeDatabase([])

			await expect(service.update({ ...input, providerCode: "onsite" }, "admin-1")).rejects.toMatchObject({
				code: "BAD_REQUEST",
			})
			expect(audit.record).not.toHaveBeenCalled()
		})

		it("answers 404 for an unknown channel", async () => {
			fakeDatabase([[]])

			await expect(service.update({ ...input, code: "nope" }, "admin-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			})
		})
	})

	describe("findUsable", () => {
		it("returns an enabled channel with the provider it is routed to now", async () => {
			fakeDatabase([[channelRow({ providerCode: "linkbiz" })]])

			const usable = await service.findUsable("gcash")

			expect(usable?.channel.code).toBe("gcash")
			expect(usable?.provider.code).toBe("linkbiz")
		})

		it("returns nothing for a disabled or unknown channel", async () => {
			fakeDatabase([[]])
			await expect(service.findUsable("maya")).resolves.toBeUndefined()
		})

		it("never routes a client's online payment to the onsite cashier provider (PAY-4)", async () => {
			fakeDatabase([[channelRow({ providerCode: "onsite" })]])
			await expect(service.findUsable("gcash")).resolves.toBeUndefined()
		})

		it("returns nothing when the channel's provider is not in this deployment", async () => {
			fakeDatabase([[channelRow({ providerCode: "retired-gateway" })]])
			await expect(service.findUsable("gcash")).resolves.toBeUndefined()
		})
	})

	describe("checkoutChannels", () => {
		const booking = { id: 31, clientId: "client-1", totalCentavos: 150000 }

		it("shows each usable channel's fee and total for the booking", async () => {
			fakeDatabase([
				[booking],
				[
					channelRow(),
					channelRow({ code: "maya", name: "Maya", convenienceFeeCentavos: 0, convenienceFeeBps: 250 }),
					channelRow({ code: "card", name: "Visa / Mastercard", providerCode: "retired-gateway" }),
				],
			])

			await expect(service.checkoutChannels(31, "client-1")).resolves.toEqual({
				bookingId: 31,
				subtotalCentavos: 150000,
				channels: [
					{ code: "gcash", name: "GCash", convenienceFeeCentavos: 1500, totalCentavos: 151500 },
					{ code: "maya", name: "Maya", convenienceFeeCentavos: 3750, totalCentavos: 153750 },
				],
			})
		})

		it("answers 404 and audits a denial for someone else's booking", async () => {
			fakeDatabase([[booking]])

			await expect(service.checkoutChannels(31, "client-2")).rejects.toMatchObject({ code: "NOT_FOUND" })
			expect(audit.record).toHaveBeenCalledWith(
				expect.objectContaining({ outcome: "denied", actorId: "client-2", reason: "not_owner" })
			)
		})
	})
})
