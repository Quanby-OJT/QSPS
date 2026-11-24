import { describe, expect, it } from "vitest"

import { CashierSearchSchema, CollectOnsiteSchema, isReferenceNumber } from "./cashier.schema"

describe("cashier schemas (PAY-4)", () => {
	it("recognizes a scanned or typed Reference Number, in any case", () => {
		expect(isReferenceNumber("QSPS-261124-AB12CD")).toBe(true)
		expect(isReferenceNumber(" qsps-261124-ab12cd ")).toBe(true)
		expect(isReferenceNumber("sam@qsps.local")).toBe(false)
		expect(isReferenceNumber("Sam Rivera")).toBe(false)
	})

	it("needs at least 3 characters to search", () => {
		expect(CashierSearchSchema.safeParse({ q: "Sa" }).success).toBe(false)
		expect(CashierSearchSchema.safeParse({ q: "  Sam " }).data).toEqual({ q: "Sam" })
	})

	const collect = { bookingId: 7, tenderType: "cash", amountDueCentavos: 150000 } as const

	it("accepts cash above the amount due, so the screen can show the change", () => {
		expect(CollectOnsiteSchema.safeParse({ ...collect, amountReceivedCentavos: 200000 }).success).toBe(true)
	})

	it("refuses less than the amount due", () => {
		expect(CollectOnsiteSchema.safeParse({ ...collect, amountReceivedCentavos: 100000 }).success).toBe(false)
	})

	it("needs the exact amount for card and check", () => {
		expect(
			CollectOnsiteSchema.safeParse({ ...collect, tenderType: "card", amountReceivedCentavos: 150000 }).success
		).toBe(true)
		expect(
			CollectOnsiteSchema.safeParse({ ...collect, tenderType: "check", amountReceivedCentavos: 160000 }).success
		).toBe(false)
	})

	it("refuses an unknown tender type", () => {
		expect(
			CollectOnsiteSchema.safeParse({ ...collect, tenderType: "gcash", amountReceivedCentavos: 150000 }).success
		).toBe(false)
	})
})
