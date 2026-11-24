import { describe, expect, it } from "vitest"

import {
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
}

describe("walk-in schemas (PRC-2)", () => {
	it("needs at least five characters to look a client up", () => {
		expect(WalkInClientLookupSchema.safeParse({ query: " 0917 " }).success).toBe(false)
		expect(WalkInClientLookupSchema.parse({ query: " 09171234567 " })).toEqual({
			query: "09171234567",
		})
	})

	it("requires an email and lowercases it", () => {
		expect(CreateWalkInClientSchema.parse(client)).toMatchObject({
			name: "Juan Dela Cruz",
			email: "juan@example.com",
			mobile: null,
		})
		expect(CreateWalkInClientSchema.safeParse({ ...client, email: "" }).success).toBe(false)
		expect(CreateWalkInClientSchema.safeParse({ ...client, email: "juan" }).success).toBe(false)
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
