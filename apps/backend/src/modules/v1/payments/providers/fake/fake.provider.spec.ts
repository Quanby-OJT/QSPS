import { describePaymentProviderContract } from "../payment-provider.contract-spec"
import { FAKE_SIGNATURE_HEADER, FakePaymentProvider, signFakeNotification } from "./fake.provider"

const SECRET = "test-secret"

describePaymentProviderContract("fake", () => ({
	provider: new FakePaymentProvider({ secret: SECRET }),
	signedNotification: ({ eventId, providerReference, status, amountCentavos }) => {
		const rawBody = JSON.stringify({
			eventId,
			reference: providerReference,
			status,
			amountCentavos,
		})
		return {
			headers: { [FAKE_SIGNATURE_HEADER]: signFakeNotification(SECRET, rawBody) },
			rawBody,
		}
	},
}))

describe("FakePaymentProvider", () => {
	it("sends the client straight to the return URL", async () => {
		const provider = new FakePaymentProvider({ secret: SECRET })
		const session = await provider.createCheckout({
			paymentId: 5,
			referenceNumber: "QSPS-261117-AB12CD",
			amountCentavos: 1000,
			description: "test",
			returnUrl: "http://localhost:3001/payments/return?paymentId=5",
			notifyUrl: "http://localhost:3000/api/v1/payments/notifications/fake",
		})

		expect(session.checkoutUrl).toBe("http://localhost:3001/payments/return?paymentId=5")
		expect(session.providerReference).toMatch(/^fake_5_[0-9a-f]{12}$/)
	})

	it("rejects a notification signed with another secret", () => {
		const provider = new FakePaymentProvider({ secret: SECRET })
		const rawBody = JSON.stringify({
			eventId: "e",
			reference: "r",
			status: "succeeded",
			amountCentavos: 1,
		})

		const parsed = provider.parseNotification({
			headers: { [FAKE_SIGNATURE_HEADER]: signFakeNotification("other-secret", rawBody) },
			rawBody,
		})

		expect(parsed.signatureValid).toBe(false)
		expect(parsed.providerReference).toBe("r")
	})
})
