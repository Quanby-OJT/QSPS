import { Inject, Injectable } from "@nestjs/common"

import { env } from "@/config/env.config"

import { FakePaymentProvider } from "./fake"
import { OnsitePaymentProvider } from "./onsite"
import { ONSITE_PROVIDER_CODE, PAYMENT_PROVIDERS, type PaymentProvider } from "./payment-provider"

/**
 * The gateways this deployment can use, built once at startup.
 *
 * This is the only file outside a gateway's own folder that may import it
 * (enforced by the ESLint boundary rule in apps/backend/eslint.config.mjs).
 * To add a gateway: create `providers/<code>/`, export its class from
 * `providers/<code>/index.ts`, and add one line below.
 */
export function buildPaymentProviders(): PaymentProvider[] {
	// PAY-4: cashier payments. Always present: it takes no notifications and
	// is never offered to clients at checkout (PaymentChannelService).
	const providers: PaymentProvider[] = [new OnsitePaymentProvider()]

	// The fake gateway keeps local development and tests working until a real
	// gateway is selected. It needs PAYMENT_FAKE_ENABLED=true and is never
	// available in production, whatever the flag says. Its secret has a public
	// default, so leaving it on by default would let anyone fake a payment on
	// any non-production server.
	if (env.PAYMENT_FAKE_ENABLED && env.NODE_ENV !== "production") {
		providers.push(new FakePaymentProvider({ secret: env.FAKE_PAYMENT_SECRET }))
	}

	// First real gateway: add it here once the team selects it, e.g.
	// providers.push(new SomeGatewayProvider({ ...credentials from env }))

	return providers
}

/** Looks providers up by code. */
@Injectable()
export class PaymentProviderRegistry {
	private readonly byCode: Map<string, PaymentProvider>

	constructor(@Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[]) {
		this.byCode = new Map()
		for (const provider of providers) {
			if (this.byCode.has(provider.code)) {
				throw new Error(`Two payment providers use the code "${provider.code}"`)
			}
			this.byCode.set(provider.code, provider)
		}
	}

	/** The provider for a code, or undefined when this deployment has none. */
	find(code: string): PaymentProvider | undefined {
		return this.byCode.get(code)
	}

	codes(): string[] {
		return [...this.byCode.keys()]
	}

	/**
	 * A provider a client may pay through online. The onsite cashier provider
	 * (PAY-4) is left out: it has no checkout page, so a payment channel can
	 * never be pointed at it.
	 */
	findOnline(code: string): PaymentProvider | undefined {
		return code === ONSITE_PROVIDER_CODE ? undefined : this.byCode.get(code)
	}

	/** Codes of the online providers, for the Payment Channels settings screen. */
	onlineCodes(): string[] {
		return this.codes().filter(code => code !== ONSITE_PROVIDER_CODE)
	}
}
