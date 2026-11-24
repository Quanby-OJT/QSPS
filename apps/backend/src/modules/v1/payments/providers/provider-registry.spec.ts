import { env } from "@/config/env.config"

import type { PaymentProvider } from "./payment-provider"
import { buildPaymentProviders, PaymentProviderRegistry } from "./provider-registry"

jest.mock("@/config/env.config", () => ({
	env: { NODE_ENV: "test", FAKE_PAYMENT_SECRET: "test-secret", PAYMENT_FAKE_ENABLED: true },
}))

const mutableEnv = env as unknown as { NODE_ENV: string; PAYMENT_FAKE_ENABLED: boolean }

function stubProvider(code: string): PaymentProvider {
	return {
		code,
		createCheckout: jest.fn(),
		parseNotification: jest.fn(),
		queryStatus: jest.fn(),
	}
}

describe("PaymentProviderRegistry", () => {
	it("finds a provider by its code", () => {
		const fake = stubProvider("fake")
		const registry = new PaymentProviderRegistry([fake, stubProvider("other")])

		expect(registry.find("fake")).toBe(fake)
		expect(registry.find("missing")).toBeUndefined()
		expect(registry.codes()).toEqual(["fake", "other"])
	})

	it("refuses two providers with the same code", () => {
		expect(() => new PaymentProviderRegistry([stubProvider("a"), stubProvider("a")])).toThrow(
			'Two payment providers use the code "a"'
		)
	})
})

describe("buildPaymentProviders", () => {
	afterEach(() => {
		mutableEnv.NODE_ENV = "test"
		mutableEnv.PAYMENT_FAKE_ENABLED = true
	})

	it("includes the fake gateway when it is turned on outside production", () => {
		expect(buildPaymentProviders().map(p => p.code)).toContain("fake")
	})

	it("leaves the fake gateway out when the flag is off", () => {
		mutableEnv.PAYMENT_FAKE_ENABLED = false
		expect(buildPaymentProviders().map(p => p.code)).not.toContain("fake")
	})

	it("leaves the fake gateway out in production even when the flag is on", () => {
		mutableEnv.NODE_ENV = "production"
		expect(buildPaymentProviders().map(p => p.code)).not.toContain("fake")
	})

	it("always includes the onsite cashier provider, in production too (PAY-4)", () => {
		mutableEnv.NODE_ENV = "production"
		mutableEnv.PAYMENT_FAKE_ENABLED = false
		expect(buildPaymentProviders().map(p => p.code)).toEqual(["onsite"])
	})
})
