import { newVerificationToken, receiptNumberFor } from "./receipt-number"

describe("receipt numbers", () => {
	it("uses the Manila date and the payment id", () => {
		// 23:30 UTC on 17 Nov is 07:30 on 18 Nov in Manila.
		expect(receiptNumberFor(7, new Date("2026-11-17T23:30:00.000Z"))).toBe("QSPS-R-261118-000007")
		expect(receiptNumberFor(1234567, new Date("2026-11-17T01:00:00.000Z"))).toBe(
			"QSPS-R-261117-1234567"
		)
	})

	it("makes 128-bit URL-safe verification tokens that differ every time", () => {
		const first = newVerificationToken()
		const second = newVerificationToken()

		expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/)
		expect(Buffer.from(first, "base64url")).toHaveLength(16)
		expect(first).not.toBe(second)
	})
})
