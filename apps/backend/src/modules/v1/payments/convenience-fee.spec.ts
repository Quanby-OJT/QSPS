import { chargeFor } from "./convenience-fee"

describe("chargeFor", () => {
	it("adds a fixed fee", () => {
		expect(chargeFor(150000, { convenienceFeeCentavos: 1500, convenienceFeeBps: 0 })).toEqual({
			subtotalCentavos: 150000,
			convenienceFeeCentavos: 1500,
			totalCentavos: 151500,
		})
	})

	it("adds a percentage of the Service fees", () => {
		// 2.5% of PHP 1,500.00 is PHP 37.50.
		expect(chargeFor(150000, { convenienceFeeCentavos: 0, convenienceFeeBps: 250 })).toEqual({
			subtotalCentavos: 150000,
			convenienceFeeCentavos: 3750,
			totalCentavos: 153750,
		})
	})

	it("adds both parts when a channel has both", () => {
		expect(
			chargeFor(150000, { convenienceFeeCentavos: 1500, convenienceFeeBps: 250 }).convenienceFeeCentavos
		).toBe(5250)
	})

	it("rounds the percentage to the nearest centavo, half up", () => {
		// 1.5% of 101 centavos = 1.515 → 2; 1.5% of 99 = 1.485 → 1.
		expect(chargeFor(101, { convenienceFeeCentavos: 0, convenienceFeeBps: 150 }).convenienceFeeCentavos).toBe(2)
		expect(chargeFor(99, { convenienceFeeCentavos: 0, convenienceFeeBps: 150 }).convenienceFeeCentavos).toBe(1)
	})

	it("charges nothing extra for a channel with no fee", () => {
		expect(chargeFor(150000, { convenienceFeeCentavos: 0, convenienceFeeBps: 0 }).totalCentavos).toBe(150000)
	})
})
