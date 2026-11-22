import { describe, expect, it } from "vitest"

import type { Policy } from "@repo/contracts"

import {
	changedLabel,
	draftOf,
	fieldHint,
	formatPolicyValue,
	groupPolicies,
	isChanged,
	parseDraft,
	textInputType,
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
	format: null,
	maxLength: null,
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

const ticketUrl: Policy = {
	...hold,
	key: "support.ticket_url",
	area: "support",
	label: "Ticketing link",
	type: "text",
	min: null,
	max: null,
	unit: null,
	format: "url",
	maxLength: 500,
	defaultValue: "",
	value: "",
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

	it("accepts a blank help desk channel, and trims text", () => {
		expect(parseDraft(ticketUrl, "  ")).toEqual({ ok: true, value: "" })
		expect(parseDraft(ticketUrl, " https://help.example.gov.ph ")).toEqual({
			ok: true,
			value: "https://help.example.gov.ph",
		})
	})

	it("checks a help desk channel with the registry's rule", () => {
		expect(parseDraft(ticketUrl, "http://help.example.gov.ph")).toEqual({
			ok: false,
			message: "Ticketing link must be a full https:// address, or blank to hide it",
		})
	})
})

describe("isChanged", () => {
	it("is false for the stored value and true for anything else", () => {
		expect(isChanged(hold, draftOf(hold))).toBe(false)
		expect(isChanged(hold, "90")).toBe(true)
		expect(isChanged(expedite, draftOf(expedite))).toBe(false)
		expect(isChanged(expedite, false)).toBe(true)
		expect(isChanged(ticketUrl, "")).toBe(false)
		expect(isChanged(ticketUrl, "https://help.example.gov.ph")).toBe(true)
	})
})

describe("labels", () => {
	it("formats values with their unit, and booleans as on or off", () => {
		expect(formatPolicyValue(hold, 60)).toBe("60 minutes")
		expect(formatPolicyValue(expedite, false)).toBe("Off")
		expect(formatPolicyValue(ticketUrl, "")).toBe("Not set")
	})

	it("gives each type its hint and each text format its input type", () => {
		expect(fieldHint(hold)).toBe("From 5 to 1440")
		expect(fieldHint(expedite)).toBe("On or off")
		expect(fieldHint(ticketUrl)).toBe("Leave blank to hide it on the Help page")
		expect(textInputType(ticketUrl)).toBe("url")
		expect(textInputType({ ...ticketUrl, format: "phone" })).toBe("tel")
		expect(textInputType({ ...ticketUrl, format: "text" })).toBe("text")
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
