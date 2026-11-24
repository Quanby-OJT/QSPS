import { ONSITE_PROVIDER_CODE } from "../payment-provider"
import { OnsitePaymentProvider } from "./onsite.provider"

const checkoutInput = {
	paymentId: 9,
	referenceNumber: "QSPS-261124-AB12CD",
	amountCentavos: 150000,
	description: "QSPS booking QSPS-261124-AB12CD",
	returnUrl: "http://localhost:3001/cashier",
	notifyUrl: "http://localhost:3000/api/v1/payments/notifications/onsite",
}

describe("OnsitePaymentProvider (PAY-4)", () => {
	it("uses the fixed code onsite", () => {
		expect(new OnsitePaymentProvider().code).toBe(ONSITE_PROVIDER_CODE)
		expect(ONSITE_PROVIDER_CODE).toBe("onsite")
	})

	it("gives each payment its own reference", async () => {
		const provider = new OnsitePaymentProvider()
		const first = await provider.createCheckout(checkoutInput)
		const second = await provider.createCheckout({ ...checkoutInput, paymentId: 10 })

		expect(first.providerReference).toMatch(/^onsite_9_[0-9a-f]{12}$/)
		expect(second.providerReference).not.toBe(first.providerReference)
	})

	it("never accepts a notification, so nothing outside can mark an onsite payment paid", () => {
		const parsed = new OnsitePaymentProvider().parseNotification({
			headers: {},
			rawBody: JSON.stringify({ reference: "onsite_9_aaaaaaaaaaaa", status: "succeeded" }),
		})

		expect(parsed).toMatchObject({ signatureValid: false, providerReference: null, status: null })
	})

	it("stores a body that is not JSON without throwing", () => {
		const parsed = new OnsitePaymentProvider().parseNotification({ headers: {}, rawBody: "not json" })

		expect(parsed.payload).toBe("not json")
		expect(parsed.signatureValid).toBe(false)
	})
})
