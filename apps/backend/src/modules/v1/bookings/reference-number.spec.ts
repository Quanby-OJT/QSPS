import { generateReferenceNumber, REFERENCE_ALPHABET } from "./reference-number"

describe("generateReferenceNumber", () => {
	it("is written QSPS-YYMMDD-XXXXXX", () => {
		expect(generateReferenceNumber(new Date("2026-11-17T06:00:00Z"))).toMatch(
			/^QSPS-261117-[A-Z0-9]{6}$/
		)
	})

	it("uses the Manila date, which is already tomorrow after 16:00 UTC", () => {
		expect(generateReferenceNumber(new Date("2026-11-17T15:59:00Z"))).toMatch(/^QSPS-261117-/)
		expect(generateReferenceNumber(new Date("2026-11-17T16:00:00Z"))).toMatch(/^QSPS-261118-/)
		expect(generateReferenceNumber(new Date("2026-12-31T16:30:00Z"))).toMatch(/^QSPS-270101-/)
	})

	it("builds the suffix from the picked characters", () => {
		const picks = [0, 1, 2, 3, 30, 31]
		let call = 0
		const pick = (max: number) => {
			expect(max).toBe(REFERENCE_ALPHABET.length)
			return picks[call++] ?? 0
		}

		expect(generateReferenceNumber(new Date("2026-11-17T06:00:00Z"), pick)).toBe(
			"QSPS-261117-ABCD89"
		)
	})

	it("never uses the easily misread characters I, O, 0 and 1", () => {
		expect(REFERENCE_ALPHABET).toHaveLength(32)
		expect(REFERENCE_ALPHABET).not.toMatch(/[IO01]/)
	})

	it("gives different numbers on repeated calls", () => {
		const now = new Date("2026-11-17T06:00:00Z")
		const numbers = new Set(Array.from({ length: 50 }, () => generateReferenceNumber(now)))
		expect(numbers.size).toBeGreaterThan(45)
	})
})
