import { describe, expect, it } from "vitest"

import { PRIVACY_NOTICE_VERSION, privacyConsentRequired } from "../../../common/privacy-notice"
import {
	AcceptPrivacyNoticeSchema,
	ClientProfileSchema,
	UpdateClientProfileSchema,
} from "./me.schema"

const valid = {
	name: "Juan Dela Cruz",
	mobile: "0917 123 4567",
	birthDate: "1995-06-15",
	nationality: "Filipino",
	gender: "Male",
}

describe("UpdateClientProfileSchema", () => {
	it("accepts a complete profile and normalizes the mobile number", () => {
		const result = UpdateClientProfileSchema.parse(valid)
		expect(result.mobile).toBe("09171234567")
	})

	it("accepts free-text gender, not only the listed options", () => {
		expect(UpdateClientProfileSchema.safeParse({ ...valid, gender: "Genderqueer" }).success).toBe(
			true
		)
	})

	it("accepts international mobile numbers", () => {
		expect(
			UpdateClientProfileSchema.safeParse({ ...valid, mobile: "+1-415-555-0100" }).success
		).toBe(true)
	})

	it.each([
		["a missing name", { name: "  " }],
		["a too-short mobile number", { mobile: "12345" }],
		["letters in the mobile number", { mobile: "0917-ABC-4567" }],
		["an impossible date", { birthDate: "2001-02-30" }],
		["a future birth date", { birthDate: "2999-01-01" }],
		["a non-ISO date", { birthDate: "06/15/1995" }],
		["an empty gender", { gender: "" }],
		["a missing nationality", { nationality: "" }],
	])("rejects %s", (_label, override) => {
		expect(UpdateClientProfileSchema.safeParse({ ...valid, ...override }).success).toBe(false)
	})
})

describe("ClientProfileSchema", () => {
	it("reads an incomplete profile with null fields", () => {
		const result = ClientProfileSchema.parse({
			name: "New Client",
			email: "new@qsps.local",
			mobile: null,
			birthDate: null,
			nationality: null,
			gender: null,
			profileCompletedAt: null,
			isComplete: false,
			privacyConsentRequired: true,
		})
		expect(result.isComplete).toBe(false)
	})

	it("reads a mobile-only account with no email (PRC-2b)", () => {
		const result = ClientProfileSchema.parse({
			name: "Walk-in Client",
			email: null,
			mobile: "09171234567",
			birthDate: "1990-02-01",
			nationality: "Filipino",
			gender: "Male",
			profileCompletedAt: null,
			isComplete: false,
			privacyConsentRequired: false,
		})
		expect(result.email).toBeNull()
	})
})

describe("Privacy Notice consent (PRC-2b)", () => {
	it("is required with no consent on record", () => {
		expect(privacyConsentRequired(null)).toBe(true)
		expect(privacyConsentRequired(undefined)).toBe(true)
		expect(privacyConsentRequired("")).toBe(true)
	})

	it("is required when the current notice is newer than the one accepted", () => {
		expect(privacyConsentRequired("2026-11-16", "2027-01-05")).toBe(true)
	})

	it("is not required for the current version", () => {
		expect(privacyConsentRequired(PRIVACY_NOTICE_VERSION)).toBe(false)
		expect(privacyConsentRequired("2027-01-05", "2027-01-05")).toBe(false)
	})

	it("accepts only the current version", () => {
		expect(
			AcceptPrivacyNoticeSchema.safeParse({ privacyNoticeVersion: PRIVACY_NOTICE_VERSION }).success
		).toBe(true)
		expect(
			AcceptPrivacyNoticeSchema.safeParse({ privacyNoticeVersion: "2020-01-01" }).success
		).toBe(false)
		expect(AcceptPrivacyNoticeSchema.safeParse({}).success).toBe(false)
	})
})
