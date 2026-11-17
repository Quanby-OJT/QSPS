import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url))

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name => name.endsWith("_seed_boq_stations"))
	if (!folder) throw new Error("The seed_boq_stations migration is missing")
	return readFileSync(`${migrationsDir}${folder}/migration.sql`, "utf8")
}

const STATION_CODES = [
	"MNL",
	"LUN",
	"LAO",
	"TUG",
	"BTN",
	"CRK",
	"SBC",
	"BTG",
	"LCN",
	"TBC",
	"PPS",
	"ILO",
	"KLO",
	"BCD",
	"DGT",
	"CEB",
	"BHL",
	"TAC",
	"ZAM",
	"CDO",
	"DVO",
	"GES",
]

describe("BOQ stations seed migration (ADM-4a)", () => {
	it("inserts all 22 TOR §IV stations, each code once", () => {
		const sql = seedSql()
		expect(STATION_CODES).toHaveLength(22)
		for (const code of STATION_CODES) {
			expect(sql.match(new RegExp(`\\('${code}',`, "g"))).toHaveLength(1)
		}
	})

	it("uses only the TOR's regional grouping", () => {
		const regions = [...seedSql().matchAll(/'(Metro Manila|Luzon|Visayas|Mindanao)'\)/g)]
		expect(regions).toHaveLength(22)
	})

	it("is insert-only and safe to re-run", () => {
		const sql = seedSql()
		expect(sql).toContain('ON CONFLICT ("code") DO NOTHING')
		expect(sql).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i)
	})
})
