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

describe("policy registry (ADM-6)", () => {
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

	it("refuses an unknown key", () => {
		expect(UpdatePolicyRequestSchema.safeParse({ key: "nope", value: 1 }).success).toBe(false)
	})
})
