import type { PaymentProvider } from "./payment-provider"
import { PaymentProviderRegistry } from "./provider-registry"

jest.mock("@/config/env.config", () => ({
	env: { NODE_ENV: "test", FAKE_PAYMENT_SECRET: "test-secret" },
}))

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
