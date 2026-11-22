import { describe, expect, it, vi } from "vitest"

import {
	createSmsSender,
	matchesMobileCode,
	mobileCodeDigest,
	normalizeSmsNumber,
	smsDestinationKey,
} from "./sms.js"

describe("SMS code and adapter", () => {
	it("normalizes the same Philippine number to a single destination", () => {
		expect(normalizeSmsNumber("0912 345 6789")).toBe("+639123456789")
		expect(normalizeSmsNumber("639123456789")).toBe("+639123456789")
		expect(normalizeSmsNumber("abc")).toBeNull()
	})
	it("binds verification to user and number", () => {
		const expected = mobileCodeDigest("test-key", "u1", "+639123456789", "123456")
		expect(
			matchesMobileCode(expected, mobileCodeDigest("test-key", "u1", "+639123456789", "123456"))
		).toBe(true)
		expect(
			matchesMobileCode(expected, mobileCodeDigest("test-key", "u2", "+639123456789", "123456"))
		).toBe(false)
		expect(smsDestinationKey("test-key", "+639123456789")).not.toContain("639123456789")
	})
	it("uses configured sender name and refuses non-success responses", async () => {
		const mock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 503 }))
		try {
			const sender = createSmsSender({
				SMS_PROVIDER: "http",
				SMS_API_URL: "https://example.test/sms",
				SMS_API_TOKEN: "test",
				SMS_SENDER_NAME: "BOQ",
			})
			await expect(sender.send("+639123456789", "Test reference")).rejects.toThrow("declined")
			expect(mock).toHaveBeenCalledWith(
				expect.any(URL),
				expect.objectContaining({
					body: JSON.stringify({ to: "+639123456789", from: "BOQ", text: "Test reference" }),
				})
			)
		} finally {
			mock.mockRestore()
		}
	})
	it("requires a configured gateway; blocks insecure production endpoints", () => {
		expect(() => createSmsSender({})).toThrow("not configured")
		expect(() =>
			createSmsSender({
				NODE_ENV: "production",
				SMS_PROVIDER: "http",
				SMS_API_URL: "http://localhost:8080",
				SMS_API_TOKEN: "test",
				SMS_SENDER_NAME: "BOQ",
			})
		).toThrow("HTTPS")
	})
})
