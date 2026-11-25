import { parseWaterAnalysis } from "./water-analysis"

describe("parseWaterAnalysis", () => {
	it("keeps analyst results and reports pass when every parameter passed", () => {
		expect(parseWaterAnalysis("Parameter A | 4 units | Pass; Parameter B | Clear | PASS")).toEqual({
			ok: true,
			outcome: "pass",
			parameters: [
				{ name: "Parameter A", result: "4 units", outcome: "pass" },
				{ name: "Parameter B", result: "Clear", outcome: "pass" },
			],
		})
	})

	it("reports fail when any parameter failed", () => {
		expect(parseWaterAnalysis("A | 4 units | Pass; B | 2 units | Fail")).toMatchObject({
			ok: true,
			outcome: "fail",
		})
	})

	it.each([
		"",
		";",
		"A | 4 units",
		"A | 4 units | Pending",
		"A | | Pass",
		"A | 4 units | Pass; a | 2 units | Fail",
	])("rejects invalid input %j", value => {
		expect(parseWaterAnalysis(value)).toMatchObject({ ok: false })
	})
})
