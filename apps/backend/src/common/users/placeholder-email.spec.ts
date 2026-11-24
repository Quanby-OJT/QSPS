import { displayEmail, isPlaceholderEmail, placeholderEmail } from "./placeholder-email"

describe("placeholder email (PRC-2b)", () => {
	it("is the user id at the reserved no-email.invalid domain", () => {
		expect(placeholderEmail("user-1")).toBe("user-1@no-email.invalid")
		expect(isPlaceholderEmail("user-1@no-email.invalid")).toBe(true)
		expect(isPlaceholderEmail("USER-1@NO-EMAIL.INVALID")).toBe(true)
	})

	it("is never shown as an email", () => {
		expect(displayEmail("user-1@no-email.invalid")).toBeNull()
		expect(displayEmail("juan@example.com")).toBe("juan@example.com")
		expect(isPlaceholderEmail("juan@no-email.invalid.example.com")).toBe(false)
		expect(isPlaceholderEmail(null)).toBe(false)
	})
})
