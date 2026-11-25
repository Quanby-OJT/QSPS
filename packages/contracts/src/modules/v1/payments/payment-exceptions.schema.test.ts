import { describe, expect, it } from "vitest"

import { ResolvePaymentReviewSchema } from "./payment-exceptions.schema"

describe("payment exception schemas (PAY-6)", () => {
	it("needs the new Reference Number when the client was rebooked", () => {
		expect(
			ResolvePaymentReviewSchema.safeParse({ paymentId: 9, resolution: "rebooked", note: "New slot given" }).success
		).toBe(false)
		expect(
			ResolvePaymentReviewSchema.safeParse({
				paymentId: 9,
				resolution: "rebooked",
				note: "New slot given",
				rebookedReferenceNumber: " qsps-261124-ab12cd ",
			}).data?.rebookedReferenceNumber
		).toBe("QSPS-261124-AB12CD")
	})

	it("opens a refund request with a note alone", () => {
		expect(
			ResolvePaymentReviewSchema.safeParse({
				paymentId: 9,
				resolution: "refund_requested",
				note: "Paid twice; return the second payment",
			}).success
		).toBe(true)
	})

	it("needs a note", () => {
		expect(
			ResolvePaymentReviewSchema.safeParse({ paymentId: 9, resolution: "refund_requested", note: " " }).success
		).toBe(false)
	})

	it("refuses an unknown resolution", () => {
		expect(
			ResolvePaymentReviewSchema.safeParse({ paymentId: 9, resolution: "ignored", note: "nothing" }).success
		).toBe(false)
	})
})
