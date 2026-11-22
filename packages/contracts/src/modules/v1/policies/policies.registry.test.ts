import { describe, expect, it } from "vitest"

import {
	getPolicyDefinition,
	isPolicyKey,
	POLICY_AREAS,
	POLICY_DEFINITIONS,
	POLICY_KEYS,
	policyValueSchema,
	validatePolicyValue,
} from "./policies.registry.js"
import { PolicyKeySchema, UpdatePolicyRequestSchema } from "./policies.schema.js"

describe("policy registry (ADM-6, ADM-8)", () => {
	it("registers every key the ticket names, including the AUTH-3 keys", () => {
		expect(POLICY_KEYS).toEqual(
			expect.arrayContaining([
				"booking.hold_minutes",
				"booking.arrival_cutoff_minutes",
				"booking.max_reschedules",
				"booking.reschedule_min_hours_before",
				"booking.expedite_enabled",
				"booking.vip_daily_limit",
				"payment.forfeit_on_no_show",
				"payment.refund_window_days",
				"auth.lockout_threshold",
				"auth.lockout_minutes",
				"auth.staff_password_max_age_days",
				"support.phone",
				"support.email",
				"support.ticket_url",
				"support.hours",
			])
		)
	})

	it("has no duplicate keys", () => {
		expect(new Set(POLICY_KEYS).size).toBe(POLICY_KEYS.length)
	})

	it.each(POLICY_DEFINITIONS.map(definition => [definition.key, definition] as const))(
		"%s has a known area and a default that passes its own rule",
		(_key, definition) => {
			expect(POLICY_AREAS).toContain(definition.area)
			expect(policyValueSchema(definition).safeParse(definition.defaultValue).success).toBe(true)
		}
	)

	it("keeps the AUTH-3 env defaults", () => {
		expect(getPolicyDefinition("auth.lockout_threshold")?.defaultValue).toBe(5)
		expect(getPolicyDefinition("auth.lockout_minutes")?.defaultValue).toBe(15)
		expect(getPolicyDefinition("auth.staff_password_max_age_days")?.defaultValue).toBe(90)
		expect(getPolicyDefinition("booking.hold_minutes")?.defaultValue).toBe(60)
	})

	it("knows registered keys and refuses others", () => {
		expect(isPolicyKey("booking.hold_minutes")).toBe(true)
		expect(isPolicyKey("booking.unknown")).toBe(false)
		expect(PolicyKeySchema.safeParse("booking.unknown").success).toBe(false)
	})
})

describe("validatePolicyValue", () => {
	it("accepts a whole number inside the range", () => {
		expect(validatePolicyValue("booking.hold_minutes", 90)).toEqual({ ok: true, value: 90 })
	})

	it.each([4, 1441, 30.5])("refuses %s minutes for the hold, naming the range", value => {
		expect(validatePolicyValue("booking.hold_minutes", value)).toEqual({
			ok: false,
			message: "Unpaid booking hold must be a whole number from 5 to 1440",
		})
	})

	it("refuses the wrong type", () => {
		expect(validatePolicyValue("booking.hold_minutes", true).ok).toBe(false)
		expect(validatePolicyValue("booking.expedite_enabled", 1)).toEqual({
			ok: false,
			message: "Expedite requests must be on or off",
		})
	})

	it("accepts a boolean for a boolean key", () => {
		expect(validatePolicyValue("payment.forfeit_on_no_show", true)).toEqual({
			ok: true,
			value: true,
		})
	})

	it("starts every help desk channel blank, so it is hidden until set", () => {
		for (const key of ["support.phone", "support.email", "support.ticket_url", "support.hours"]) {
			expect(getPolicyDefinition(key)?.defaultValue).toBe("")
			expect(validatePolicyValue(key, "")).toEqual({ ok: true, value: "" })
		}
	})

	it("trims text and treats spaces only as blank", () => {
		expect(validatePolicyValue("support.email", "  help@example.gov.ph ")).toEqual({
			ok: true,
			value: "help@example.gov.ph",
		})
		expect(validatePolicyValue("support.hours", "   ")).toEqual({ ok: true, value: "" })
	})

	it.each(["+63 2 8123 4567", "(02) 8123-4567", "09171234567"])("accepts the phone %s", value => {
		expect(validatePolicyValue("support.phone", value).ok).toBe(true)
	})

	it.each(["12345", "call us", "+63 2 8123 4567 ext 2", "1234567890123456"])(
		"refuses the phone %s",
		value => {
			expect(validatePolicyValue("support.phone", value)).toEqual({
				ok: false,
				message:
					"Help desk phone must be a phone number of 7 to 15 digits, e.g. +63 2 8123 4567, or blank to hide it",
			})
		}
	)

	it("checks the email and the ticketing link", () => {
		expect(validatePolicyValue("support.email", "not-an-email").ok).toBe(false)
		expect(
			validatePolicyValue("support.ticket_url", "https://help.example.gov.ph/tickets").ok
		).toBe(true)
		expect(validatePolicyValue("support.ticket_url", "http://help.example.gov.ph")).toEqual({
			ok: false,
			message: "Ticketing link must be a full https:// address, or blank to hide it",
		})
		expect(validatePolicyValue("support.ticket_url", "ftp://help.example.gov.ph").ok).toBe(false)
	})

	it("limits text length", () => {
		expect(validatePolicyValue("support.hours", "x".repeat(201))).toEqual({
			ok: false,
			message: "Support hours must be at most 200 characters",
		})
	})

	it("refuses a number for a text key", () => {
		expect(validatePolicyValue("support.hours", 9)).toEqual({
			ok: false,
			message: "Support hours must be text",
		})
	})

	it("refuses an unknown key", () => {
		expect(validatePolicyValue("booking.unknown", 1)).toEqual({
			ok: false,
			message: 'Unknown policy "booking.unknown"',
		})
	})
})

describe("UpdatePolicyRequestSchema", () => {
	it("accepts a valid change", () => {
		expect(
			UpdatePolicyRequestSchema.safeParse({ key: "auth.lockout_minutes", value: 30 }).success
		).toBe(true)
	})

	it("puts a range error on the value field", () => {
		const parsed = UpdatePolicyRequestSchema.safeParse({ key: "auth.lockout_threshold", value: 0 })
		expect(parsed.success).toBe(false)
		if (!parsed.success) {
			expect(parsed.error.issues[0]).toMatchObject({
				path: ["value"],
				message: "Failed sign-ins before lock must be a whole number from 1 to 20",
			})
		}
	})

	it("accepts a blank help desk channel", () => {
		expect(UpdatePolicyRequestSchema.safeParse({ key: "support.phone", value: "" }).success).toBe(
			true
		)
	})

	it("refuses an unknown key", () => {
		expect(UpdatePolicyRequestSchema.safeParse({ key: "nope", value: 1 }).success).toBe(false)
	})
})
