import { describe, expect, it } from "vitest"

import { feeInPesos, parseFeeCentavos } from "./fee"

describe("parseFeeCentavos", () => {
	it.each([
		["150", 15000],
		["150.5", 15050],
		["150.50", 15050],
		["0.05", 5],
		["0.29", 29],
		["0", 0],
		[" 12.34 ", 1234],
	])("turns %s pesos into %i centavos", (input, expected) => {
		expect(parseFeeCentavos(input)).toBe(expected)
	})

	it.each(["", "abc", "-1", "1.234", "150.", ".5", "1,000", "21474836.48"])(
		"rejects %s",
		input => {
			expect(parseFeeCentavos(input)).toBeNull()
		}
	)
})

describe("feeInPesos", () => {
	it("shows two decimals", () => {
		expect(feeInPesos(15050)).toBe("150.50")
		expect(feeInPesos(5)).toBe("0.05")
		expect(feeInPesos(0)).toBe("0.00")
	})
})