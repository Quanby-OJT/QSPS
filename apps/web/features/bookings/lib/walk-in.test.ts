import { describe, expect, it } from "vitest"

import { canChooseWalkInSlot, draftFromLookup, placesLeftLabel, walkInLookupKind } from "./walk-in"

describe("walk-in helpers (PRC-2)", () => {
	it("searches only for a whole email address or mobile number", () => {
		expect(walkInLookupKind(" Juan@Example.com ")).toBe("email")
		expect(walkInLookupKind("juan@example")).toBeNull()
		expect(walkInLookupKind("0917 123 4567")).toBe("mobile")
		expect(walkInLookupKind("+63-917-123-4567")).toBe("mobile")
		expect(walkInLookupKind("0917123")).toBeNull()
		expect(walkInLookupKind("Juan Dela Cruz")).toBeNull()
		expect(walkInLookupKind("")).toBeNull()
	})

	it("lets a slot be chosen only while it has a place", () => {
		expect(canChooseWalkInSlot({ remaining: 1 })).toBe(true)
		expect(canChooseWalkInSlot({ remaining: 0 })).toBe(false)
		expect(placesLeftLabel({ remaining: 0 })).toBe("Full")
		expect(placesLeftLabel({ remaining: 1 })).toBe("1 place left")
		expect(placesLeftLabel({ remaining: 12 })).toBe("12 places left")
	})

	it("starts a new client with the email or mobile that was searched for", () => {
		expect(draftFromLookup("Juan@Example.com")).toMatchObject({
			email: "juan@example.com",
			mobile: "",
		})
		expect(draftFromLookup("09171234567")).toMatchObject({ email: "", mobile: "09171234567" })
	})
})
