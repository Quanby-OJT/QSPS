import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import type {
	CheckoutSession,
	CreateCheckoutInput,
	ParsedNotification,
	PaymentProvider,
	ProviderPaymentStatus,
	ProviderStatusResult,
	RawNotification,
} from "../payment-provider"

/** The header the fake gateway signs its notifications in. */
export const FAKE_SIGNATURE_HEADER = "x-fake-signature"

/** The notification body the fake gateway sends. */
export interface FakeNotificationBody {
	eventId: string
	reference: string
	status: ProviderPaymentStatus
	amountCentavos: number
}

const STATUSES: readonly ProviderPaymentStatus[] = ["pending", "succeeded", "failed", "expired"]

/** Hex HMAC-SHA256 of the raw body: how the fake gateway signs. */
export function signFakeNotification(secret: string, rawBody: string): string {
	return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
}

function signaturesMatch(expected: string, received: string | undefined): boolean {
	if (!received) return false
	const a = Buffer.from(expected, "utf8")
	const b = Buffer.from(received, "utf8")
	return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(value: unknown): Partial<FakeNotificationBody> {
	if (typeof value !== "object" || value === null) return {}
	const body = value as Record<string, unknown>
	return {
		eventId: typeof body.eventId === "string" ? body.eventId : undefined,
		reference: typeof body.reference === "string" ? body.reference : undefined,
		status: STATUSES.includes(body.status as ProviderPaymentStatus)
			? (body.status as ProviderPaymentStatus)
			: undefined,
		amountCentavos: Number.isInteger(body.amountCentavos)
			? (body.amountCentavos as number)
			: undefined,
	}
}

/**
 * A pretend gateway for tests and local development. It has no hosted page:
 * checkout sends the client straight to the return URL, and a "payment" is
 * completed by posting a signed notification (see the PAY-1 notes in
 * apps/backend/README.md). Never registered in production.
 */
export class FakePaymentProvider implements PaymentProvider {
	readonly code = "fake"

	private readonly secret: string
	private readonly statuses = new Map<string, ProviderStatusResult>()

	constructor(options: { secret: string }) {
		this.secret = options.secret
	}

	async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
		const providerReference = `fake_${input.paymentId}_${randomBytes(6).toString("hex")}`
		this.statuses.set(providerReference, {
			status: "pending",
			amountCentavos: input.amountCentavos,
		})
		return { providerReference, checkoutUrl: input.returnUrl }
	}

	parseNotification(notification: RawNotification): ParsedNotification {
		const signatureValid = signaturesMatch(
			signFakeNotification(this.secret, notification.rawBody),
			notification.headers[FAKE_SIGNATURE_HEADER]
		)

		let payload: unknown = notification.rawBody
		try {
			payload = JSON.parse(notification.rawBody) as unknown
		} catch {
			// Not JSON: kept as text so the event can still be stored.
		}
		const body = readBody(payload)

		if (signatureValid && body.reference && body.status) {
			this.statuses.set(body.reference, {
				status: body.status,
				amountCentavos: body.amountCentavos ?? null,
			})
		}

		return {
			eventId: body.eventId ?? null,
			providerReference: body.reference ?? null,
			status: body.status ?? null,
			amountCentavos: body.amountCentavos ?? null,
			signatureValid,
			payload,
		}
	}

	async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
		return this.statuses.get(providerReference) ?? { status: "pending", amountCentavos: null }
	}
}
