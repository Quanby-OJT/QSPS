/**
 * The one interface every payment gateway sits behind (PRD decision B2,
 * TOR §X.D: no lock-in).
 *
 * Nothing outside `providers/<gateway-code>/` may import a gateway's own
 * types; the rest of the system sees only what is declared here. Adding a
 * gateway means a new folder that implements this interface, passes the
 * shared contract tests (payment-provider.contract-spec.ts) and has one entry in
 * provider-registry.ts.
 */

/** What the provider reports about a payment, in our own words. */
export type ProviderPaymentStatus = "pending" | "succeeded" | "failed" | "expired"

export interface CreateCheckoutInput {
	/** Our Payment id. Providers usually echo it back as a merchant reference. */
	paymentId: number
	/** The Booking's Reference Number, shown to the client on the checkout page. */
	referenceNumber: string
	/** The exact amount to charge, in centavos (PHP). */
	amountCentavos: number
	/** Short text shown on the checkout page. Must not contain personal data. */
	description: string
	/** Where the provider sends the client's browser afterwards. */
	returnUrl: string
	/** Where the provider sends its server-to-server notification. */
	notifyUrl: string
}

export interface CheckoutSession {
	/** The provider's id for this payment; used to match its notifications. */
	providerReference: string
	/** The provider's hosted checkout page. */
	checkoutUrl: string
}

/** A provider notification exactly as it reached us. */
export interface RawNotification {
	/** Header names in lower case. */
	headers: Record<string, string | undefined>
	/** The body bytes as sent, decoded as UTF-8. Signatures are computed over this. */
	rawBody: string
}

export interface ParsedNotification {
	/**
	 * The provider's id for this notification, used to drop redeliveries.
	 * Null when it cannot be read; the caller then uses a hash of the body.
	 */
	eventId: string | null
	/** Which payment it is about. Null when it cannot be read. */
	providerReference: string | null
	status: ProviderPaymentStatus | null
	/** The amount the provider says was paid, in centavos. */
	amountCentavos: number | null
	/** True only when the signature was checked and matched. */
	signatureValid: boolean
	/** The body as stored in payment_events. */
	payload: unknown
}

export interface ProviderStatusResult {
	status: ProviderPaymentStatus
	amountCentavos: number | null
}

export interface PaymentProvider {
	/** Lowercase code, e.g. "fake", "linkbiz". Stored on every payment. */
	readonly code: string

	/** Open a hosted checkout for the exact amount. */
	createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>

	/**
	 * Read and verify a notification. Must never throw: a malformed or forged
	 * notification comes back with `signatureValid: false` so it can still be
	 * stored and alerted on.
	 */
	parseNotification(notification: RawNotification): ParsedNotification

	/** Ask the provider for a payment's current status (used by PAY-6). */
	queryStatus(providerReference: string): Promise<ProviderStatusResult>
}

/**
 * The provider code of payments taken at a BOQ cashier (PAY-4). Fixed by
 * DOMAIN-MODEL.md, and declared here so the payment service can name it
 * without importing the adapter (the gateway boundary rule).
 */
export const ONSITE_PROVIDER_CODE = "onsite"

/** Nest injection token for the registry's provider list. */
export const PAYMENT_PROVIDERS = Symbol("PAYMENT_PROVIDERS")
