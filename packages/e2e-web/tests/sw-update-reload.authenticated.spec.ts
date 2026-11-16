import { expect, test, type Page } from "@playwright/test"

import { ADMIN_AUTH_FILE } from "../constants"
import { installSessionReadRecovery } from "../fixtures"

test.beforeEach(async ({ page }) => {
	installSessionReadRecovery(page)
})

/**
 * A first visit must not reload when the worker claims.
 *
 * Fresh context per test, so no worker is installed yet. Admin storage is the
 * setup project's session; this test does not sign in again. The accepted
 * update reload is covered by the sw-reload unit tests: Chromium does not
 * expose the service-worker script fetch to Playwright routing.
 */

const mainFrameNavigations = (page: Page) => {
	const urls: string[] = []
	page.on("framenavigated", frame => {
		if (frame === page.mainFrame()) urls.push(frame.url())
	})
	return urls
}

test.describe("service worker first claim", () => {
	test.use({ storageState: ADMIN_AUTH_FILE })

	test("first visit does not reload when the worker claims", async ({ page }) => {
		const loads: string[] = []
		page.on("load", () => {
			loads.push(page.url())
		})
		const navigations = mainFrameNavigations(page)

		await page.goto("/dashboard")
		const navigationsAfterGoto = navigations.length
		const loadsAfterGoto = loads.length
		const dashboardUrl = page.url()
		// Stamp the document goto created. A claim reload would replace it and
		// fire another load. A same-document history update can still emit
		// framenavigated for this same URL without doing either.
		await page.evaluate(() => {
			document.documentElement.dataset.e2eDoc = "original"
		})

		await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({
			timeout: 15_000,
		})

		await expect
			.poll(async () => page.evaluate(() => navigator.serviceWorker?.controller != null), {
				timeout: 10_000,
			})
			.toBe(true)

		const afterGoto = navigations.slice(navigationsAfterGoto)
		expect(afterGoto).toEqual(afterGoto.map(() => dashboardUrl))
		expect(loads.slice(loadsAfterGoto)).toEqual([])
		expect(await page.evaluate(() => document.documentElement.dataset.e2eDoc)).toBe("original")
		expect(
			await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.type ?? "none")
		).toBe("navigate")
	})
})