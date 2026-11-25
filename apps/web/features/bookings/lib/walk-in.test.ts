import { describe, expect, it } from "vitest"

import { PRIVACY_NOTICE_VERSION } from "@repo/contracts"

import {
	canChooseWalkInSlot,
	checkWalkInClientDraft,
	clientEmailLabel,
	draftFromLookup,
	EMPTY_WALK_IN_CLIENT,
	placesLeftLabel,
	walkInLookupKind,
} from "./walk-in"

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

describe("walk-in new client (PRC-2b)", () => {
	const draft = {
		...EMPTY_WALK_IN_CLIENT,
		name: "Maria Santos",
		mobile: "0917 123 4567",
		birthDate: "1990-02-01",
		nationality: "Filipino",
		gender: "Female",
		privacyAccepted: true,
	}

	it("is refused without the Privacy Notice tick", () => {
		const checked = checkWalkInClientDraft({ ...draft, privacyAccepted: false })
		expect(checked.ok).toBe(false)
		if (!checked.ok) {
			expect(checked.errors.privacyAccepted).toMatch(/privacy notice/i)
		}
	})

	it("sends the current notice version once ticked, and allows a mobile-only client", () => {
		const checked = checkWalkInClientDraft(draft)
		expect(checked).toEqual({
			ok: true,
			input: expect.objectContaining({
				email: null,
				mobile: "09171234567",
				privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
			}),
		})
		if (checked.ok) expect(checked.input).not.toHaveProperty("privacyAccepted")
	})

	it("needs an email or a mobile number", () => {
		const checked = checkWalkInClientDraft({ ...draft, mobile: "" })
		expect(checked.ok).toBe(false)
		if (!checked.ok) expect(checked.errors.email).toMatch(/email address or mobile number/i)
	})

	it("shows No email for a client without one", () => {
		expect(clientEmailLabel(null)).toBe("No email")
		expect(clientEmailLabel("juan@example.com")).toBe("juan@example.com")
	})
})
