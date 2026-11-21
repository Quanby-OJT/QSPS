import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

import robots from "../../../../app/robots"
import sitemap from "../../../../app/sitemap"

/**
 * AUTH-3: no page on the public site or client portal links to the staff
 * sign-in route, and it is in neither the sitemap nor robots.txt.
 */

const WEB_ROOT = join(__dirname, "..", "..", "..", "..")
const STAFF_PATH = "/staff/sign-in"

/** Files allowed to name the route: the page itself and this test. */
const ALLOWED = new Set([
	["app", "(auth)", "staff", "sign-in", "page.tsx"].join(sep),
	["features", "auth", "login", "lib", "staff-sign-in-hidden.test.ts"].join(sep),
])

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) return sourceFiles(path)
		return /\.(ts|tsx)$/.test(name) ? [path] : []
	})
}

describe("staff sign-in route stays hidden (AUTH-3)", () => {
	it("is not named by any page, component or config outside its own page", () => {
		const offenders = ["app", "core", "features", "services"]
			.flatMap(folder => sourceFiles(join(WEB_ROOT, folder)))
			.map(file => relative(WEB_ROOT, file))
			.filter(file => !ALLOWED.has(file))
			.filter(file => readFileSync(join(WEB_ROOT, file), "utf8").includes(STAFF_PATH))

		expect(offenders).toEqual([])
	})

	it("is not in robots.txt, even as Disallow", () => {
		expect(JSON.stringify(robots())).not.toContain("staff")
	})

	it("is not in the sitemap", () => {
		expect(sitemap().map(entry => entry.url).join(" ")).not.toContain("staff")
	})

	it("keeps the portal out of crawlers' reach", () => {
		const rules = robots().rules
		const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap(rule =>
			Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow]
		)
		expect(disallowed).toEqual(expect.arrayContaining(["/dashboard", "/user-management"]))
	})
})