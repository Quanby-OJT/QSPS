import { describe, expect, it } from "vitest"

import { PRIVACY_NOTICE_VERSION } from "@repo/contracts"

import { privacyNoticeRedirect } from "./privacy-notice"

describe("privacyNoticeRedirect (PRC-2b)", () => {
	it("asks a client with no consent on record", () => {
		expect(privacyNoticeRedirect({ isClient: true, privacyNoticeVersion: null })).toBe(
			"/privacy-notice"
		)
		expect(privacyNoticeRedirect({ isClient: true })).toBe("/privacy-notice")
	})

	it("asks a client who accepted an older notice", () => {
		expect(privacyNoticeRedirect({ isClient: true, privacyNoticeVersion: "2020-01-01" })).toBe(
			"/privacy-notice"
		)
	})

	it("does not ask a client who accepted the current notice", () => {
		expect(
			privacyNoticeRedirect({ isClient: true, privacyNoticeVersion: PRIVACY_NOTICE_VERSION })
		).toBeNull()
	})

	it("does not ask staff", () => {
		expect(privacyNoticeRedirect({ isClient: false, privacyNoticeVersion: null })).toBeNull()
	})
})
