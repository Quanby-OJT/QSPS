import { afterEach, describe, expect, it, vi } from "vitest"

import {
	allowAllCaptchaVerifier,
	CAPTCHA_PATHS,
	createTurnstileVerifier,
	MissingCaptchaConfigError,
	resolveCaptchaVerifier,
	TURNSTILE_VERIFY_URL,
} from "./captcha.js"

function answer(body: unknown, ok = true) {
	return vi.fn().mockResolvedValue({ ok, json: async () => body })
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe("createTurnstileVerifier (AUTH-3)", () => {
	it("accepts a token Turnstile confirms, sending the secret and client address", async () => {
		const fetchImpl = answer({ success: true })
		const verifier = createTurnstileVerifier("secret-key", fetchImpl)

		await expect(verifier.verify("token-1", "203.0.113.7")).resolves.toBe(true)

		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
		expect(url).toBe(TURNSTILE_VERIFY_URL)
		const sent = init.body as URLSearchParams
		expect(sent.get("secret")).toBe("secret-key")
		expect(sent.get("response")).toBe("token-1")
		expect(sent.get("remoteip")).toBe("203.0.113.7")
	})

	it("refuses a missing token without calling the provider", async () => {
		const fetchImpl = answer({ success: true })
		const verifier = createTurnstileVerifier("secret-key", fetchImpl)

		await expect(verifier.verify(undefined)).resolves.toBe(false)
		await expect(verifier.verify("")).resolves.toBe(false)
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it.each([
		["the provider says no", answer({ success: false })],
		["the provider answers an error status", answer({ success: true }, false)],
		["the answer has no success flag", answer({})],
		["the success flag is not exactly true", answer({ success: "true" })],
	])("fails closed when %s", async (_label, fetchImpl) => {
		await expect(createTurnstileVerifier("s", fetchImpl).verify("t")).resolves.toBe(false)
	})

	it("fails closed and logs when the provider cannot be reached", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
		const fetchImpl = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"))

		await expect(createTurnstileVerifier("s", fetchImpl).verify("t")).resolves.toBe(false)
		expect(error).toHaveBeenCalledOnce()
	})
})

describe("resolveCaptchaVerifier", () => {
	it("refuses to boot in production without a secret", () => {
		expect(() => resolveCaptchaVerifier({ nodeEnv: "production" })).toThrow(
			MissingCaptchaConfigError
		)
		expect(() => resolveCaptchaVerifier({ nodeEnv: "production" })).toThrow(/CAPTCHA_SECRET_KEY/)
	})

	it("uses Turnstile whenever a secret is set", () => {
		const verifier = resolveCaptchaVerifier({ secret: "s", nodeEnv: "production" })
		expect(verifier).not.toBe(allowAllCaptchaVerifier)
	})

	it.each(["development", "test", undefined])(
		"lets requests through without a secret when NODE_ENV is %s, and says so",
		nodeEnv => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
			expect(resolveCaptchaVerifier({ nodeEnv })).toBe(allowAllCaptchaVerifier)
			expect(String(warn.mock.calls[0]?.[0])).toMatch(/NOT checked/)
		}
	)
})

describe("CAPTCHA_PATHS", () => {
	it("covers registration, sign-in and both reset steps", () => {
		expect([...CAPTCHA_PATHS].sort()).toEqual([
			"/forget-password",
			"/request-password-reset",
			"/reset-password",
			"/sign-in/email",
			"/sign-up/email",
		])
	})
})