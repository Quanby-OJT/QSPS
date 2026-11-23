import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url))

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name => name.endsWith("_seed_payment_channels"))
	if (!folder) throw new Error("The seed_payment_channels migration is missing")
	return readFileSync(`${migrationsDir}${folder}/migration.sql`, "utf8")
}

/** TOR §VIII.2's channels, in the order the TOR lists them. */
const CHANNEL_CODES = ["linkbiz", "gcash", "maya", "card", "bancnet", "grabpay", "seven-eleven"]

describe("payment channels seed migration (PAY-5)", () => {
	it("inserts every TOR §VIII.2 channel, each code once", () => {
		const sql = seedSql()
		for (const code of CHANNEL_CODES) {
			expect(sql.match(new RegExp(`\\('${code}',`, "g"))).toHaveLength(1)
		}
	})

	it("leaves every channel disabled with no provider, so nothing goes live by itself", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "payment_channels" \("code", "name"\) VALUES/)
		expect(sql).not.toMatch(/is_enabled/)
		expect(sql).not.toMatch(/provider_code/)
	})

	it("is safe to run again", () => {
		expect(seedSql()).toMatch(/ON CONFLICT \("code"\) DO NOTHING;/)
	})
})
