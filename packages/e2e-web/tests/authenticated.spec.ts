import { expect, test } from "@playwright/test"

import { installSessionReadRecovery, signInAs, signOutToLogin } from "../fixtures"
import { gotoAndSettle } from "../service-worker"

// All tests in this file run with stored auth session (chromium-authenticated project).

test.beforeEach(async ({ page }) => {
	installSessionReadRecovery(page)
})

test.describe("authenticated home page", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/")
	})

	test("shows the logged-in user's name", async ({ page }) => {
		// Authenticated home page greets with "Hello [name]" instead of "Welcome Everyone!"
		await expect(page.locator("p").filter({ hasText: /^Hello\s/ })).toBeVisible()
	})

	test("shows a Logout button instead of a Login link", async ({ page }) => {
		await expect(page.getByRole("button", { name: /logout/i })).toBeVisible()
		await expect(page.getByRole("link", { name: /^login$/i })).not.toBeVisible()
	})

	test("an authenticated visitor can still open the login page", async ({ page }) => {
		// This asserted a redirect to `/` that the app does not perform.
		// `/login` is a STATIC route (see the build output) and therefore cannot
		// read the session; implementing the redirect would make it dynamic and
		// undo the static-route work for no security benefit — the page is
		// public either way. Asserting the real behaviour instead of an
		// imagined one.
		await page.goto("/login")
		await expect(page).toHaveURL(/\/login/)
		// The submit button reads "Login" (and "Signing in..." while pending) —
		// `/sign in/i` matched neither, so this never passed. auth.spec.ts already
		// targets the real control; same selector here.
		await expect(page.getByRole("button", { name: /^login$/i })).toBeVisible()

		// The session is unaffected by visiting it.
		await page.goto("/dashboard")
		await expect(page).toHaveURL(/\/dashboard/)
	})
})

test.describe("authenticated dashboard", () => {
	test("is accessible without redirect", async ({ page }) => {
		await page.goto("/dashboard")
		await expect(page).toHaveURL(/\/dashboard/)
	})

	test("shows the Dashboard breadcrumb", async ({ page }) => {
		await page.goto("/dashboard")
		await expect(
			page.locator('[data-slot="breadcrumb-page"]', { hasText: /dashboard/i })
		).toBeVisible()
	})
})

test.describe("authenticated session page", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/session")
	})

	test("loads without redirecting to login", async ({ page }) => {
		await expect(page).toHaveURL(/\/session/)
	})

	test("displays session information", async ({ page }) => {
		// There is no standalone "Session" text on the page — the drift
		// this suite was full of. Assert the two headings that actually exist.
		await expect(page.getByText("Server Session")).toBeVisible()
		await expect(page.getByText("Client Session")).toBeVisible()
	})

	test("server session is not null", async ({ page }) => {
		// Session JSON is rendered inside a <pre> in the ServerSession component.
		await expect(page.locator("pre").first()).not.toContainText('"null"')
	})

	test("server session includes user email", async ({ page }) => {
		const testEmail = process.env.E2E_TEST_EMAIL ?? "test@gmail.com"
		await expect(page.locator("pre").first()).toContainText(testEmail)
	})
})

/**
 * Sign-out, in an ISOLATED context.
 *
 * This lived in the shared-`storageState` block with a comment acknowledging it
 * "can make other authenticated tests flaky". It did more than that: clicking
 * Logout revokes the session server-side, so every test that ran afterwards saw
 * an invalid cookie and failed. The mitigation there — re-signing in over the
 * API first — could not work, because the browser still logs out whatever
 * cookie it is holding.
 *
 * An empty `storageState` plus its own sign-in means this test cannot reach the
 * shared session at all, so ordering stops mattering.
 */
test.describe("sign-out", () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test("returns to the logged-out state and re-guards protected routes", async ({ page }) => {
		// Sign-out shares one address. A 429 waits for `x-retry-after` (at most 61s, twice).
		// The default 30s test timeout kills that wait. Assertion timeouts are unchanged.
		test.setTimeout(180_000)
		// Sign in through the shared fixture, so this sign-in gets the same 429 retry as
		// every other. Better Auth rate-limits `sign-in/email` per path, and a
		// full serial run makes enough sign-ins to trip it — which used to fail
		// this test for a reason unrelated to sign-out.
		await signInAs(page, "userB")

		// Settle before the click. A click that lands before hydration leaves this
		// button on screen and the session intact. The first claim does not reload.
		await gotoAndSettle(page, "/")
		await signOutToLogin(page)

		// A protected route must send the now-signed-out visitor to login.
		await page.goto("/dashboard")
		await expect(page).toHaveURL(/\/login/)
	})
})