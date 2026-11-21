import { afterEach, describe, expect, it, vi } from "vitest"

import {
	isPasswordExpired,
	PASSWORD_HISTORY_DEPTH,
	readAuthPolicies,
	setAuthPolicyReader,
	type AuthPolicies,
} from "./auth-policies.js"
import { buildAccountLockedEmail } from "./mailer/templates/account-locked-email.js"

const defaults: AuthPolicies = {
	lockoutThreshold: 5,
	lockoutMinutes: 15,
	staffPasswordMaxAgeDays: 90,
}

afterEach(() => {
	setAuthPolicyReader(null)
	vi.restoreAllMocks()
})

describe("readAuthPolicies (AUTH-3)", () => {
	it("uses the env defaults until ADM-6 registers PolicyService", async () => {
		await expect(readAuthPolicies(defaults)).resolves.toEqual(defaults)
	})

	it("takes the registered reader's values over the defaults", async () => {
		setAuthPolicyReader(async () => ({ lockoutThreshold: 3 }))

		await expect(readAuthPolicies(defaults)).resolves.toEqual({ ...defaults, lockoutThreshold: 3 })
	})

	it("ignores values that would switch the protection off", async () => {
		setAuthPolicyReader(async () => ({ lockoutThreshold: 0, lockoutMinutes: -1 }))

		await expect(readAuthPolicies(defaults)).resolves.toEqual(defaults)
	})

	it("falls back to the defaults when the reader fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined)
		setAuthPolicyReader(async () => {
			throw new Error("database unavailable")
		})

		await expect(readAuthPolicies(defaults)).resolves.toEqual(defaults)
	})
})

describe("isPasswordExpired", () => {
	const day = 24 * 60 * 60 * 1000
	const now = new Date("2026-11-21T00:00:00Z")

	it("is false within the maximum age and true past it", () => {
		expect(isPasswordExpired(new Date(now.getTime() - 89 * day), new Date(0), 90, now)).toBe(false)
		expect(isPasswordExpired(new Date(now.getTime() - 91 * day), new Date(0), 90, now)).toBe(true)
	})

	it("counts from account creation when the password was never changed", () => {
		expect(isPasswordExpired(null, new Date(now.getTime() - 100 * day), 90, now)).toBe(true)
		expect(isPasswordExpired(null, new Date(now.getTime() - 10 * day), 90, now)).toBe(false)
	})
})

describe("password history depth", () => {
	it("is five, as TOR §II asks", () => {
		expect(PASSWORD_HISTORY_DEPTH).toBe(5)
	})
})

describe("buildAccountLockedEmail", () => {
	it("says how long the lock lasts and carries no link", () => {
		const email = buildAccountLockedEmail({ minutes: 15, attempts: 5 })

		expect(email.text).toContain("15 minutes")
		expect(email.text).toContain("5 failed sign-in attempts")
		expect(email.html).not.toMatch(/<a\s/i)
	})
})