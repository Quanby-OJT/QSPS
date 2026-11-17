import { Inject, Injectable } from "@nestjs/common"

import { env } from "@/config/env.config"

import { FakePaymentProvider } from "./fake"
import { PAYMENT_PROVIDERS, type PaymentProvider } from "./payment-provider"

/**
 * The gateways this deployment can use, built once at startup.
 *
 * This is the only file outside a gateway's own folder that may import it
 * (enforced by the ESLint boundary rule in apps/backend/eslint.config.mjs).
 * To add a gateway: create `providers/<code>/`, export its class from
 * `providers/<code>/index.ts`, and add one line below.
 */
export function buildPaymentProviders(): PaymentProvider[] {
	const providers: PaymentProvider[] = []

	// The fake gateway keeps local development and tests working until a real
	// gateway is selected. It is never available in production.
	if (env.NODE_ENV !== "production") {
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
}
