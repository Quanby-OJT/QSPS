import { randomBytes } from "node:crypto"

import {
	type CheckoutSession,
	type CreateCheckoutInput,
	ONSITE_PROVIDER_CODE,
	type ParsedNotification,
	type PaymentProvider,
	type ProviderStatusResult,
	type RawNotification,
} from "../payment-provider"

/**
 * Payments collected in person at a BOQ cashier (PAY-4, TOR §VIII.1).
 *
 * There is no gateway: the cashier is the one who confirms the money, so
 * `PaymentService.collectOnsite` confirms the Payment in the same
 * transaction that creates it. This adapter only hands out a reference and
 * never accepts a notification, so nothing from outside can mark an onsite
 * Payment paid.
 */
export class OnsitePaymentProvider implements PaymentProvider {
	readonly code = ONSITE_PROVIDER_CODE

	createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
		// No hosted page: the client is standing at the counter. The return URL
		// is echoed so the interface stays the same for every provider.
		return Promise.resolve({
			providerReference: `onsite_${input.paymentId}_${randomBytes(6).toString("hex")}`,
			checkoutUrl: input.returnUrl,
		})
	}

	parseNotification(notification: RawNotification): ParsedNotification {
		// Onsite payments are never confirmed by a notification. Anything sent to
		// /payments/notifications/onsite is stored and flagged as not signed.
		let payload: unknown = notification.rawBody
		try {
			payload = JSON.parse(notification.rawBody) as unknown
		} catch {
			// Keep the raw text.
		}
		return {
			eventId: null,
			providerReference: null,
			status: null,
			amountCentavos: null,
			signatureValid: false,
			payload,
		}
	}

	queryStatus(): Promise<ProviderStatusResult> {
		// The cashier confirmed it in our own database; there is no one to ask.
		return Promise.resolve({ status: "pending", amountCentavos: null })
	}
}
