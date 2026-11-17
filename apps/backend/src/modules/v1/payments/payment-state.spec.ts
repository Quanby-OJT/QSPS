import { canTransitionPayment } from "./payment-state"

describe("payment state machine", () => {
	it("follows the arrows in DOMAIN-MODEL.md 5.3", () => {
		expect(canTransitionPayment("initiated", "pending")).toBe(true)
		expect(canTransitionPayment("pending", "succeeded")).toBe(true)
		expect(canTransitionPayment("pending", "failed")).toBe(true)
		expect(canTransitionPayment("pending", "expired")).toBe(true)
		expect(canTransitionPayment("succeeded", "refunded")).toBe(true)
	})

	it("never leaves succeeded except to refunded", () => {
		expect(canTransitionPayment("succeeded", "failed")).toBe(false)
		expect(canTransitionPayment("succeeded", "pending")).toBe(false)
		expect(canTransitionPayment("refunded", "succeeded")).toBe(false)
	})

	it("lets money that arrived late still count", () => {
		expect(canTransitionPayment("failed", "succeeded")).toBe(true)
		expect(canTransitionPayment("expired", "succeeded")).toBe(true)
	})
})
