import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { and, asc, eq } from "drizzle-orm"

import type {
	CheckoutChannels,
	PaymentChannel,
	PaymentChannelSettings,
	UpdatePaymentChannelInput,
} from "@repo/contracts"
import { bookings, paymentChannels } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

import { chargeFor } from "./convenience-fee"
import type { PaymentProvider } from "./providers/payment-provider"
import { PaymentProviderRegistry } from "./providers/provider-registry"

const AUDIT_DOMAIN_PAYMENTS = "payments"

type ChannelRow = typeof paymentChannels.$inferSelect

/** A channel a client can pay with right now, and the provider that serves it. */
export interface UsableChannel {
	channel: ChannelRow
	provider: PaymentProvider
}

function toPaymentChannel(row: ChannelRow): PaymentChannel {
	return {
		code: row.code,
		name: row.name,
		providerCode: row.providerCode,
		convenienceFeeCentavos: row.convenienceFeeCentavos,
		convenienceFeeBps: row.convenienceFeeBps,
		isEnabled: row.isEnabled,
	}
}

/** The settings audited on every change, as old and new values. No personal data. */
function auditedValues(row: ChannelRow) {
	return {
		name: row.name,
		providerCode: row.providerCode,
		convenienceFeeCentavos: row.convenienceFeeCentavos,
		convenienceFeeBps: row.convenienceFeeBps,
		isEnabled: row.isEnabled,
	}
}

/**
 * Payment channels (PAY-5): which channels are on, which provider serves
 * each, and what convenience fee each charges. Routing is read from the
 * database on every payment, so changing a channel's provider takes effect
 * on the next payment with no deployment (PRD decision B2).
 */
@Injectable()
export class PaymentChannelService {
	constructor(
		private readonly auditService: AuditService,
		private readonly providers: PaymentProviderRegistry
	) {}

	/** Every channel, for the settings screen, plus the providers it may pick. */
	async listForSettings(): Promise<PaymentChannelSettings> {
		const rows = await db.select().from(paymentChannels).orderBy(asc(paymentChannels.name))
		return { channels: rows.map(toPaymentChannel), providerCodes: this.providers.onlineCodes() }
	}

	/**
	 * Change one channel. Applies to new Payments only: each Payment already
	 * stores the fee it was charged. Audited with old and new values.
	 */
	async update(input: UpdatePaymentChannelInput, actorId: string | null): Promise<PaymentChannel> {
		if (input.providerCode !== null && !this.providers.findOnline(input.providerCode)) {
			throw new ORPCError("BAD_REQUEST", {
				message: `No payment provider "${input.providerCode}" is available in this deployment`,
			})
		}

		return db.transaction(async tx => {
			const [current] = await tx
				.select()
				.from(paymentChannels)
				.where(eq(paymentChannels.code, input.code))
				.for("update")
			if (!current) {
				throw new ORPCError("NOT_FOUND", { message: `Payment channel "${input.code}" was not found` })
			}

			const [updated] = await tx
				.update(paymentChannels)
				.set({
					name: input.name,
					providerCode: input.providerCode,
					convenienceFeeCentavos: input.convenienceFeeCentavos,
					convenienceFeeBps: input.convenienceFeeBps,
					isEnabled: input.isEnabled,
					updatedAt: new Date(),
				})
				.where(eq(paymentChannels.code, input.code))
				.returning()
			if (!updated) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Payment channel could not be updated" })
			}

			const feeChanged =
				updated.convenienceFeeCentavos !== current.convenienceFeeCentavos ||
				updated.convenienceFeeBps !== current.convenienceFeeBps
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_PAYMENTS,
					action: feeChanged ? "payment_channel.fee.update" : "payment_channel.update",
					actorId,
					targetType: "payment_channel",
					targetId: updated.code,
					oldValue: auditedValues(current),
					newValue: auditedValues(updated),
				},
				tx
			)

			return toPaymentChannel(updated)
		})
	}

	/**
	 * The channel a client asked to pay with, if it is enabled and its provider
	 * exists in this deployment. Otherwise undefined: not offered, not usable.
	 */
	async findUsable(code: string): Promise<UsableChannel | undefined> {
		const [channel] = await db
			.select()
			.from(paymentChannels)
			.where(and(eq(paymentChannels.code, code), eq(paymentChannels.isEnabled, true)))
			.limit(1)
		const provider = channel?.providerCode ? this.providers.findOnline(channel.providerCode) : undefined
		return channel && provider ? { channel, provider } : undefined
	}

	/**
	 * What checkout shows for one booking: its Service fees, then each usable
	 * channel with its convenience fee and total, worked out by `chargeFor`,
	 * the same function `PaymentService.create` charges with. Only the
	 * booking's owner may ask; anyone else gets a 404 and the denial is audited.
	 */
	async checkoutChannels(bookingId: number, actorId: string | null): Promise<CheckoutChannels> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to pay" })
		}

		const [booking] = await db
			.select({ id: bookings.id, clientId: bookings.clientId, totalCentavos: bookings.totalCentavos })
			.from(bookings)
			.where(eq(bookings.id, bookingId))
			.limit(1)

		if (!booking || booking.clientId !== actorId) {
			await this.auditService.record({
				domain: AUDIT_DOMAIN_PAYMENTS,
				action: "payment_channel.checkout",
				outcome: "denied",
				actorId,
				targetType: "booking",
				targetId: String(bookingId),
				reason: booking ? "not_owner" : "not_found",
			})
			throw new ORPCError("NOT_FOUND", { message: "Booking not found" })
		}

		const rows = await db
			.select()
			.from(paymentChannels)
			.where(eq(paymentChannels.isEnabled, true))
			.orderBy(asc(paymentChannels.name))

		const channels = rows
			.filter(row => row.providerCode !== null && this.providers.findOnline(row.providerCode))
			.map(row => {
				const charge = chargeFor(booking.totalCentavos, row)
				return {
					code: row.code,
					name: row.name,
					convenienceFeeCentavos: charge.convenienceFeeCentavos,
					totalCentavos: charge.totalCentavos,
				}
			})

		return { bookingId: booking.id, subtotalCentavos: booking.totalCentavos, channels }
	}
}
