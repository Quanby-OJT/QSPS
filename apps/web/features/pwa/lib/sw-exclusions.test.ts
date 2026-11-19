import { describe, expect, it } from "vitest"

import {
	bypassesServiceWorker,
	carriesToken,
	isAuthenticatedRoute,
	mayServeOfflineFallback,
	TOKEN_PARAMS,
	TOKEN_PATH_PREFIXES,
} from "./sw-exclusions"

// Reset and verification links travel as `?token=…` URLs
// that the service worker could cache, turning a single-use credential into a
// stored one; and the offline fallback was served for authenticated
// navigations, masking auth state.

const url = (path: string) => new URL(path, "https://app.example.com")

describe("carriesToken", () => {
	it.each(TOKEN_PARAMS)("detects ?%s=", param => {
		expect(carriesToken(url(`/reset-password?${param}=abc123`))).toBe(true)
	})

	it("detects a token alongside other parameters", () => {
		expect(carriesToken(url("/verify-email?callbackURL=/dashboard&token=abc"))).toBe(true)
	})

	it("does not flag ordinary URLs", () => {
		expect(carriesToken(url("/login"))).toBe(false)
		expect(carriesToken(url("/search?q=token"))).toBe(false)
	})

	it("does not flag a parameter that merely contains a token name", () => {
		expect(carriesToken(url("/x?tokenCount=3"))).toBe(false)
	})

	it.each(TOKEN_PATH_PREFIXES)("detects a verification token in the path after %s", prefix => {
		expect(carriesToken(url(`${prefix}D53c9uPTeejxoiwDBMIHAw`))).toBe(true)
	})

	it("does not flag the manual verification page or look-alike paths", () => {
		// /verify has no token; /verify-email carries its token as ?token=.
		expect(carriesToken(url("/verify"))).toBe(false)
		expect(carriesToken(url("/verify/"))).toBe(false)
		expect(carriesToken(url("/verify-email"))).toBe(false)
		expect(carriesToken(url("/receipts"))).toBe(false)
	})
})

describe("isAuthenticatedRoute", () => {
	it.each(["/dashboard", "/account", "/user-management", "/session"])(
		"treats %s as authenticated",
		path => {
			expect(isAuthenticatedRoute(url(path))).toBe(true)
		}
	)

	it("covers nested paths", () => {
		expect(isAuthenticatedRoute(url("/user-management/roles/3"))).toBe(true)
	})

	it("does not over-match a similarly-named public route", () => {
		// `/accounts-public` must not be swept up by a prefix check.
		expect(isAuthenticatedRoute(url("/accounts-public"))).toBe(false)
	})

	it.each(["/", "/login", "/register", "/forgot-password", "/~offline", "/verify"])(
		"leaves %s public",
		path => {
			expect(isAuthenticatedRoute(url(path))).toBe(false)
		}
	)

	it("leaves the public document verification page public (CRT-2)", () => {
		expect(isAuthenticatedRoute(url("/verify/D53c9uPTeejxoiwDBMIHAw"))).toBe(false)
	})
})

describe("mayServeOfflineFallback", () => {
	it("allows the fallback for public pages", () => {
		expect(mayServeOfflineFallback(url("/login"))).toBe(true)
		expect(mayServeOfflineFallback(url("/verify"))).toBe(true)
	})

	it("refuses to fake an authenticated page", () => {
		// Otherwise a signed-out visitor sees a plausible app shell instead of
		// being sent to sign in.
		expect(mayServeOfflineFallback(url("/dashboard"))).toBe(false)
	})

	it("refuses to stand in for a token link", () => {
		// The offline shell cannot consume a token, so serving it strands the
		// user on a link they cannot retry.
		expect(mayServeOfflineFallback(url("/reset-password?token=abc"))).toBe(false)
	})

	it("refuses to stand in for a document or receipt verification link (CRT-2)", () => {
		// An offline page there could be mistaken for "no record found".
		expect(mayServeOfflineFallback(url("/verify/D53c9uPTeejxoiwDBMIHAw"))).toBe(false)
		expect(mayServeOfflineFallback(url("/receipts/verify/D53c9uPTeejxoiwDBMIHAw"))).toBe(false)
	})
})

describe("bypassesServiceWorker", () => {
	const workerOrigin = "http://localhost:3001"

	it("bypasses a cross-origin API URL", () => {
		expect(
			bypassesServiceWorker(new URL("http://localhost:3000/api/v1/health"), workerOrigin)
		).toBe(true)
	})

	it("bypasses the cross-origin document verification API (CRT-2)", () => {
		expect(
			bypassesServiceWorker(
				new URL("http://localhost:3000/api/v1/certificates/verify/D53c9uPTeejxoiwDBMIHAw"),
				workerOrigin
			)
		).toBe(true)
	})

	it("bypasses a same-origin /api/v1 URL", () => {
		expect(bypassesServiceWorker(new URL(`${workerOrigin}/api/v1/todos`), workerOrigin)).toBe(true)
	})

	it("bypasses bare /api", () => {
		expect(bypassesServiceWorker(new URL(`${workerOrigin}/api`), workerOrigin)).toBe(true)
	})

	it("bypasses a cross-origin non-API URL", () => {
		expect(bypassesServiceWorker(new URL("https://cdn.example.com/font.woff2"), workerOrigin)).toBe(
			true
		)
	})

	it("does not bypass a same-origin page", () => {
		expect(bypassesServiceWorker(new URL(`${workerOrigin}/dashboard`), workerOrigin)).toBe(false)
	})

	it("does not bypass a same-origin static asset", () => {
		expect(
			bypassesServiceWorker(new URL(`${workerOrigin}/_next/static/chunks/app.js`), workerOrigin)
		).toBe(false)
	})

	it("does not bypass a lookalike path such as /apiary", () => {
		expect(bypassesServiceWorker(new URL(`${workerOrigin}/apiary`), workerOrigin)).toBe(false)
	})
})
