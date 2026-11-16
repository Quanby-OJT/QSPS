import fs from "fs"
import { expect, test, type Cookie, type Page } from "@playwright/test"

import { ADMIN_AUTH_FILE, USER_B_AUTH_FILE } from "../constants"
import { ACCOUNTS, installSessionReadRecovery, signInAs, signOutToLogin } from "../fixtures"
import { gotoAndSettle, settleServiceWorker } from "../service-worker"

test.beforeEach(async ({ page }) => {
	installSessionReadRecovery(page)
})

/**
 * Cache isolation on a shared browser profile.
 *
 * This automates the audit's own verification script: sign in as admin, open
 * `/user-management`, sign out, then inspect IndexedDB. Before the fix the
 * persisted TanStack cache held the session identity and the full
 * `["rbac","users"]` email directory under one shared, user-agnostic key for
 * 24h — restorable by whoever used the browser next, and readable from
 * DevTools without authenticating at all.
 *
 * Read-only cases reuse the sessions saved by setup. Cases that sign out sign
 * in as **userB** on their own: logout revokes that session server-side, and
 * userA is the account the shared `storageState` holds a token for. Using
 * userA here would log the rest of the authenticated project out mid-run.
 */

// The seeded Admin holds `users.accounts:read`, so `/user-management` returns the real
// email directory — the exact PII the audit found sitting on disk.
const ADMIN_EMAIL = ACCOUNTS.admin.email
const TEST_EMAIL = ACCOUNTS.userB.email

function hasSessionCookie(file: string): boolean {
	const state = JSON.parse(fs.readFileSync(file, "utf8")) as {
		cookies?: { name: string }[]
	}
	return !!state.cookies?.some(cookie => cookie.name === "better-auth.session_token")
}

async function useStoredSession(page: Page, file: string): Promise<void> {
	const state = JSON.parse(fs.readFileSync(file, "utf8")) as { cookies?: Cookie[] }
	await page.context().clearCookies()
	if (state.cookies?.length) await page.context().addCookies(state.cookies)
}

/**
 * Dump every value held in every IndexedDB database for this origin.
 *
 * Deliberately reads *all* databases rather than the one key we expect: the
 * claim under test is that nothing sensitive is anywhere on disk, not that one
 * known key happens to be clean.
 */
async function dumpIndexedDb(page: Page): Promise<{ keys: string[]; contents: string }> {
	return page.evaluate(async () => {
		const databases = (await indexedDB.databases?.()) ?? []
		const allKeys: string[] = []
		const chunks: string[] = []

		for (const info of databases) {
			if (!info.name) continue

			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const openRequest = indexedDB.open(info.name as string)
				openRequest.onsuccess = () => resolve(openRequest.result)
				openRequest.onerror = () => reject(openRequest.error)
			})

			for (const storeName of Array.from(db.objectStoreNames)) {
				const store = db.transaction(storeName, "readonly").objectStore(storeName)

				const storeKeys = await new Promise<IDBValidKey[]>((resolve, reject) => {
					const keyRequest = store.getAllKeys()
					keyRequest.onsuccess = () => resolve(keyRequest.result)
					keyRequest.onerror = () => reject(keyRequest.error)
				})

				const values = await new Promise<unknown[]>((resolve, reject) => {
					const valueRequest = store.getAll()
					valueRequest.onsuccess = () => resolve(valueRequest.result)
					valueRequest.onerror = () => reject(valueRequest.error)
				})

				allKeys.push(...storeKeys.filter((key): key is string => typeof key === "string"))
				// The persister stores its snapshot as a JSON *string*. Concatenate
				// the raw values instead of re-stringifying them, or every quote gets
				// escaped and substring assertions silently stop matching anything.
				chunks.push(
					values
						.map(value => (typeof value === "string" ? value : JSON.stringify(value)))
						.join("\n")
				)
			}

			db.close()
		}

		return { keys: allKeys, contents: chunks.join("\n") }
	})
}

const cacheKeys = (keys: string[]) =>
	keys.filter(key => key.startsWith("qsps-query-cache"))

/** Wait for the persister to have written at least one snapshot. */
async function waitForPersistedSnapshot(page: Page): Promise<string[]> {
	await expect
		.poll(async () => cacheKeys((await dumpIndexedDb(page)).keys).length, { timeout: 20_000 })
		.toBeGreaterThan(0)

	return cacheKeys((await dumpIndexedDb(page)).keys)
}

/** Load the pages that populate the sensitive query roots. */
async function visitCachePopulatingPages(page: Page, isAdmin: boolean) {
	// Settle the worker before any IndexedDB read. The first claim does not
	// reload the page. Settling still waits until the worker controls it, so a
	// navigation cannot destroy the evaluate inside `dumpIndexedDb`.
	await gotoAndSettle(page, "/dashboard")
	await expect(page).toHaveURL(/\/dashboard/)
	await settleServiceWorker(page)

	if (isAdmin) {
		await page.goto("/user-management")
		// The directory must actually be on screen — otherwise this test could
		// pass simply because the data never loaded.
		await expect(page.getByText(ADMIN_EMAIL, { exact: false }).first()).toBeVisible()
	}
}

test.describe("persisted cache isolation", () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test("never writes the session identity or the email directory to IndexedDB", async ({
		page,
	}) => {
		const isAdmin = hasSessionCookie(ADMIN_AUTH_FILE)
		if (isAdmin) {
			await useStoredSession(page, ADMIN_AUTH_FILE)
		} else {
			// Fall back to the standard test account: the session-exclusion half of
			// the fix is still provable without the directory.
			// eslint-disable-next-line no-console
			console.warn("[wc-1] admin unavailable; directory check skipped")
			await useStoredSession(page, USER_B_AUTH_FILE)
		}

		const email = isAdmin ? ADMIN_EMAIL : TEST_EMAIL

		await visitCachePopulatingPages(page, isAdmin)
		await waitForPersistedSnapshot(page)

		const { contents } = await dumpIndexedDb(page)

		// The signed-in user's own email must never reach disk...
		expect(contents).not.toContain(email)
		// ...nor any other seeded directory address...
		expect(contents).not.toContain("@qsps.local")
		// ...nor the excluded query roots themselves.
		expect(contents).not.toContain('"rbac"')
		expect(contents).not.toContain('"session"')

		// And the snapshot carries the buster + timestamp that bound its lifetime.
		expect(contents).toContain('"buster"')
		expect(contents).toContain('"timestamp"')
	})

	test("writes to an identity-scoped key, never the shared default", async ({ page }) => {
		await useStoredSession(page, USER_B_AUTH_FILE)
		await visitCachePopulatingPages(page, false)

		const keys = await waitForPersistedSnapshot(page)

		// The pre-fix persister wrote every user's snapshot to this one key.
		expect(keys).not.toContain("REACT_QUERY_OFFLINE_CACHE")
		for (const key of keys) {
			expect(key).toMatch(/^qsps-query-cache:.+/)
		}
	})

	test("gives a second user a different cache bucket than the first", async ({ page }) => {
		// Sign-out shares one address. A 429 waits for `x-retry-after` (at most 61s, twice).
		// The default 30s test timeout kills that wait. Assertion timeouts are unchanged.
		test.setTimeout(180_000)
		await signInAs(page, "userB")
		await visitCachePopulatingPages(page, false)
		const firstUserKeys = await waitForPersistedSnapshot(page)

		// Sign out so the first user's bucket is purged, then hand the browser to
		// the next person — the scenario the audit describes.
		await gotoAndSettle(page, "/")
		await signOutToLogin(page)

		const isAdmin = hasSessionCookie(ADMIN_AUTH_FILE)
		test.skip(!isAdmin, "second account unavailable in this environment")
		await useStoredSession(page, ADMIN_AUTH_FILE)

		await visitCachePopulatingPages(page, true)
		const secondUserKeys = await waitForPersistedSnapshot(page)

		expect(secondUserKeys).not.toEqual([])
		for (const key of secondUserKeys) {
			expect(firstUserKeys).not.toContain(key)
		}
	})

	test("sign-out purges every persisted cache entry from IndexedDB", async ({ page }) => {
		// Sign-out shares one address. A 429 waits for `x-retry-after` (at most 61s, twice).
		// The default 30s test timeout kills that wait. Assertion timeouts are unchanged.
		test.setTimeout(180_000)
		await signInAs(page, "userB")
		await visitCachePopulatingPages(page, false)
		const signedInKeys = await waitForPersistedSnapshot(page)

		await gotoAndSettle(page, "/")
		await signOutToLogin(page)

		// The signed-in user's bucket must be gone. Browsing on as an anonymous
		// visitor legitimately creates a fresh anonymous bucket, so assert on the
		// keys that existed while signed in — and on the data, which must be empty.
		await expect
			.poll(
				async () => {
					const keys = cacheKeys((await dumpIndexedDb(page)).keys)
					return signedInKeys.filter(key => keys.includes(key))
				},
				{ timeout: 20_000 }
			)
			.toEqual([])

		const { contents } = await dumpIndexedDb(page)
		expect(contents).not.toContain(TEST_EMAIL)
	})
})