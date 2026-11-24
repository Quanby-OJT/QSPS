import { describe, expect, it } from "vitest"

import { PRIVACY_NOTICE_VERSION } from "../../../common/privacy-notice.js"
import {
	AddWalkInClientEmailSchema,
	CreateWalkInBookingSchema,
	CreateWalkInClientSchema,
	WalkInClientLookupSchema,
	WalkInSlotsSchema,
} from "./walk-in.schema.js"

const client = {
	name: " Juan Dela Cruz ",
	email: " Juan@Example.COM ",
	birthDate: "1990-02-01",
	nationality: "Filipino",
	gender: "Male",
	privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
}

describe("walk-in schemas (PRC-2)", () => {
	it("needs at least five characters to look a client up", () => {
		expect(WalkInClientLookupSchema.safeParse({ query: " 0917 " }).success).toBe(false)
		expect(WalkInClientLookupSchema.parse({ query: " 09171234567 " })).toEqual({
			query: "09171234567",
		})
	})

	it("lowercases the email and refuses one that is not valid", () => {
		expect(CreateWalkInClientSchema.parse(client)).toMatchObject({
			name: "Juan Dela Cruz",
			email: "juan@example.com",
			mobile: null,
		})
		expect(CreateWalkInClientSchema.safeParse({ ...client, email: "juan" }).success).toBe(false)
	})

	it("needs an email or a mobile number (PRC-2b)", () => {
		const mobileOnly = CreateWalkInClientSchema.parse({
			...client,
			email: "",
			mobile: "0917 123 4567",
		})
		expect(mobileOnly).toMatchObject({ email: null, mobile: "09171234567" })
		expect(
			CreateWalkInClientSchema.parse({ ...client, email: undefined, mobile: "09171234567" })
		).toMatchObject({ email: null })

		const neither = CreateWalkInClientSchema.safeParse({ ...client, email: " ", mobile: "" })
		expect(neither.success).toBe(false)
		expect(neither.error?.issues[0]).toMatchObject({
			path: ["email"],
			message: "Enter the client's email address or mobile number",
		})
	})

	it("refuses a .invalid address typed at the counter", () => {
		expect(
			CreateWalkInClientSchema.safeParse({ ...client, email: "abc@no-email.invalid" }).success
		).toBe(false)
		expect(
			AddWalkInClientEmailSchema.safeParse({ clientId: "c-1", email: "abc@no-email.invalid" })
				.success
		).toBe(false)
	})

	it("refuses the account without the Privacy Notice tick (PRC-2b)", () => {
		const unticked: Partial<typeof client> = { ...client }
		delete unticked.privacyNoticeVersion
		const missing = CreateWalkInClientSchema.safeParse(unticked)
		expect(missing.success).toBe(false)
		expect(missing.error?.issues.map(issue => issue.path)).toContainEqual(["privacyNoticeVersion"])
		expect(
			CreateWalkInClientSchema.safeParse({ ...client, privacyNoticeVersion: "2020-01-01" }).success
		).toBe(false)
	})

	it("adds a real email to a client, lowercased", () => {
		expect(
			AddWalkInClientEmailSchema.parse({ clientId: " c-1 ", email: " Juan@Example.COM " })
		).toEqual({ clientId: "c-1", email: "juan@example.com" })
		expect(AddWalkInClientEmailSchema.safeParse({ clientId: "c-1", email: "" }).success).toBe(false)
	})

	it("takes an optional mobile number without spaces or dashes", () => {
		expect(CreateWalkInClientSchema.parse({ ...client, mobile: "0917-123 4567" }).mobile).toBe(
			"09171234567"
		)
		expect(CreateWalkInClientSchema.parse({ ...client, mobile: "+639171234567" }).mobile).toBe(
			"+639171234567"
		)
		expect(CreateWalkInClientSchema.parse({ ...client, mobile: "  " }).mobile).toBeNull()
		expect(CreateWalkInClientSchema.safeParse({ ...client, mobile: "12345" }).success).toBe(false)
		expect(CreateWalkInClientSchema.safeParse({ ...client, mobile: "0917abc4567" }).success).toBe(
			false
		)
	})

	it("refuses a birth date that is not a real past date", () => {
		for (const birthDate of ["1990-02-30", "01/02/1990", "1899-12-31", "2999-01-01"]) {
			expect(CreateWalkInClientSchema.safeParse({ ...client, birthDate }).success).toBe(false)
		}
	})

	it("books for a chosen client with the same items and policies as a client's own booking", () => {
		expect(
			CreateWalkInBookingSchema.parse({ clientId: "client-1", items: [{ scheduleSlotId: 7 }] })
		).toMatchObject({ clientId: "client-1", acceptedPolicyDocumentIds: [] })
		expect(CreateWalkInBookingSchema.safeParse({ items: [{ scheduleSlotId: 7 }] }).success).toBe(
			false
		)
		expect(CreateWalkInBookingSchema.safeParse({ clientId: "client-1", items: [] }).success).toBe(
			false
		)
	})

	it("reads slot times from JSON strings", () => {
		const parsed = WalkInSlotsSchema.parse({
			location: { id: 2, name: "Manila" },
			date: "2026-11-24",
			slots: [
				{
					id: 7,
					startsAt: "2026-11-24T06:00:00.000Z",
					endsAt: "2026-11-24T10:00:00.000Z",
					capacity: 20,
					bookedCount: 3,
					remaining: 17,
					inProgress: true,
				},
			],
		})
		expect(parsed.slots[0]?.startsAt).toBeInstanceOf(Date)
	})
})
