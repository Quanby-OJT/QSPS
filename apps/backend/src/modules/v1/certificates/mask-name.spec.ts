import { holderNameOf, maskName } from "./mask-name"

describe("maskName", () => {
	it("keeps only the first letter of each word", () => {
		expect(maskName("Juan Dela Cruz")).toBe("J*** D*** C***")
	})

	it("does not reveal how long each word is", () => {
		expect(maskName("Al Bartholomew")).toBe("A*** B***")
	})

	it("collapses extra spaces and uppercases the initial", () => {
		expect(maskName("  maria   clara ")).toBe("M*** C***")
	})

	it("handles letters outside ASCII", () => {
		expect(maskName("Ñora Ébano")).toBe("Ñ*** É***")
	})

	it("shows a dash for an empty name", () => {
		expect(maskName("   ")).toBe("-")
	})
})

describe("holderNameOf", () => {
	it("reads holder.name from a payload", () => {
		expect(holderNameOf({ holder: { name: "Juan Dela Cruz", passportOrIdNumber: "P1" } })).toBe(
			"Juan Dela Cruz"
		)
	})

	it("returns an empty string when there is no holder name", () => {
		expect(holderNameOf({})).toBe("")
		expect(holderNameOf({ holder: null })).toBe("")
		expect(holderNameOf({ holder: { name: 42 } })).toBe("")
	})
})
