import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CAPTCHA_HEADER, captchaHeaders, useCaptcha } from "./captcha"

describe("captchaHeaders (AUTH-3)", () => {
	it("sends the token in the header the API reads", () => {
		expect(captchaHeaders("tok")).toEqual({ "x-captcha-response": "tok" })
		expect(CAPTCHA_HEADER).toBe("x-captcha-response")
	})

	it("sends nothing without a token", () => {
		expect(captchaHeaders(null)).toEqual({})
	})
})

describe("useCaptcha", () => {
	it("is ready at once and shows no widget when no site key is set", () => {
		const { result } = renderHook(() => useCaptcha(undefined))

		expect(result.current.enabled).toBe(false)
		expect(result.current.ready).toBe(true)
		expect(result.current.widget).toBeNull()
		expect(result.current.headers()).toEqual({})
	})

	it("waits for a token when a site key is set", () => {
		const { result } = renderHook(() => useCaptcha("site-key"))

		expect(result.current.enabled).toBe(true)
		expect(result.current.ready).toBe(false)
		expect(result.current.widget).not.toBeNull()
	})
})