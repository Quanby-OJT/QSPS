import { describe, expect, it } from "vitest"

import type { Policy } from "@repo/contracts"

import {
	changedLabel,
	draftOf,
	formatPolicyValue,
	groupPolicies,
	isChanged,
	parseDraft,
} from "./policy-form"

const hold: Policy = {
	key: "booking.hold_minutes",
	area: "booking",
	label: "Unpaid booking hold",
	description: "How long an unpaid booking keeps its slot.",
	type: "integer",
	min: 5,
	max: 1440,
	unit: "minutes",
	defaultValue: 60,
	value: 60,
	isDefault: true,
	updatedAt: null,
	updatedByEmail: null,
}

const expedite: Policy = {
	...hold,
	key: "booking.expedite_enabled",
	label: "Expedite requests",
	type: "boolean",
	min: null,
	max: null,
	unit: null,
	defaultValue: true,
	value: true,
}

const lockout: Policy = {
	...hold,
	key: "auth.lockout_minutes",
	area: "auth",
	label: "Lock length",
	min: 1,
	defaultValue: 15,
	value: 15,
}

describe("groupPolicies", () => {
	it("groups by area in registry order and leaves out empty areas", () => {
		const groups = groupPolicies([lockout, hold, expedite])

		expect(groups.map(group => group.label)).toEqual(["Booking", "Sign-in security"])
		expect(groups[0]?.policies.map(policy => policy.key)).toEqual([
			"booking.hold_minutes",
			"booking.expedite_enabled",
		])
	})
})

describe("parseDraft", () => {
	it("accepts a whole number in range", () => {
		expect(parseDraft(hold, " 90 ")).toEqual({ ok: true, value: 90 })
	})

	it("names the range when the number is outside it", () => {
		expect(parseDraft(hold, "4")).toEqual({
			ok: false,
			message: "Unpaid booking hold must be a whole number from 5 to 1440",
		})
		expect(parseDraft(hold, "12.5").ok).toBe(false)
	})

	it("asks for a value when the field is empty", () => {
		expect(parseDraft(hold, "")).toEqual({
			ok: false,
			message: "Enter a value for Unpaid booking hold",
		})
	})

	it("reads a checkbox as on or off", () => {
		expect(parseDraft(expedite, false)).toEqual({ ok: true, value: false })
	})
})

describe("isChanged", () => {
	it("is false for the stored value and true for anything else", () => {
		expect(isChanged(hold, draftOf(hold))).toBe(false)
		expect(isChanged(hold, "90")).toBe(true)
		expect(isChanged(expedite, draftOf(expedite))).toBe(false)
		expect(isChanged(expedite, false)).toBe(true)
	})
})

describe("labels", () => {
	it("formats values with their unit, and booleans as on or off", () => {
		expect(formatPolicyValue(hold, 60)).toBe("60 minutes")
		expect(formatPolicyValue(expedite, false)).toBe("Off")
	})

	it("says who changed a value, and nothing for a default", () => {
		expect(changedLabel(hold)).toBeNull()
		expect(
			changedLabel({
				...hold,
				isDefault: false,
				updatedAt: new Date("2026-11-21T15:07:00.000Z"),
				updatedByEmail: "admin@qsps.local",
			})
		).toMatch(/^Changed by admin@qsps\.local on .*2026/)
	})
})
