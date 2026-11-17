import type { PaymentProvider, RawNotification } from "./payment-provider"

/**
 * Shared contract tests every gateway adapter must pass (PAY-1).
 *
 * An adapter's own spec calls this with a factory. The factory returns the
 * adapter set up with sandbox credentials, plus a way to produce a correctly
 * signed notification, so the same checks run against every gateway.
 */
export interface ProviderContractHarness {
	provider: PaymentProvider
	/** A notification the gateway would really send, correctly signed. */
	signedNotification(body: {
		eventId: string
		providerReference: string
		status: "succeeded" | "failed"
		amountCentavos: number
	}): RawNotification
}

const checkoutInput = {
	paymentId: 1,
	referenceNumber: "QSPS-261117-AB12CD",
	amountCentavos: 150000,
	description: "QSPS booking QSPS-261117-AB12CD",
	returnUrl: "http://localhost:3001/payments/return?paymentId=1",
	notifyUrl: "http://localhost:3000/api/v1/payments/notifications/test",
}

export function describePaymentProviderContract(
	name: string,
	makeHarness: () => ProviderContractHarness
): void {
	describe(`${name}: PaymentProvider contract`, () => {
		it("has a lowercase code", () => {
			expect(makeHarness().provider.code).toMatch(/^[a-z][a-z0-9-]{1,31}$/)
		})

		it("opens a checkout and returns a reference and a URL", async () => {
			const { provider } = makeHarness()
			const session = await provider.createCheckout(checkoutInput)

			expect(session.providerReference).toEqual(expect.any(String))
			expect(session.providerReference.length).toBeGreaterThan(0)
			expect(() => new URL(session.checkoutUrl)).not.toThrow()
		})

		it("gives a different reference to each checkout", async () => {
			const { provider } = makeHarness()
			const first = await provider.createCheckout(checkoutInput)
			const second = await provider.createCheckout({ ...checkoutInput, paymentId: 2 })

			expect(first.providerReference).not.toBe(second.providerReference)
		})

		it("reads a correctly signed success notification", async () => {
			const harness = makeHarness()
			const { providerReference } = await harness.provider.createCheckout(checkoutInput)
			const parsed = harness.provider.parseNotification(
				harness.signedNotification({
					eventId: "evt-1",
					providerReference,
					status: "succeeded",
					amountCentavos: 150000,
				})
			)

			expect(parsed).toMatchObject({
				eventId: "evt-1",
				providerReference,
				status: "succeeded",
				amountCentavos: 150000,
				signatureValid: true,
			})
		})

		it("flags a notification whose body was changed after signing", async () => {
			const harness = makeHarness()
			const signed = harness.signedNotification({
				eventId: "evt-2",
				providerReference: "ref-1",
				status: "succeeded",
				amountCentavos: 150000,
			})
			const tampered = { ...signed, rawBody: signed.rawBody.replace("150000", "100") }

			expect(harness.provider.parseNotification(tampered).signatureValid).toBe(false)
		})

		it("flags a notification with no signature", () => {
			const harness = makeHarness()
			const signed = harness.signedNotification({
				eventId: "evt-3",
				providerReference: "ref-1",
				status: "succeeded",
				amountCentavos: 150000,
			})

			expect(
				harness.provider.parseNotification({ headers: {}, rawBody: signed.rawBody }).signatureValid
			).toBe(false)
		})

		it("does not throw on a body it cannot read", () => {
			const { provider } = makeHarness()
			const parsed = provider.parseNotification({ headers: {}, rawBody: "not json at all" })

			expect(parsed.signatureValid).toBe(false)
		})

		it("answers a status query with a known status", async () => {
			const { provider } = makeHarness()
			const { providerReference } = await provider.createCheckout(checkoutInput)
			const result = await provider.queryStatus(providerReference)

			expect(["pending", "succeeded", "failed", "expired"]).toContain(result.status)
		})
	})
}
