import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url))

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name => name.endsWith("_seed_sanitation"))
	if (!folder) throw new Error("The seed_sanitation migration is missing")
	return readFileSync(`${migrationsDir}${folder}/migration.sql`, "utf8")
}

describe("sanitation seed migration (CRT-5)", () => {
	it("adds both sanitation Services in their category, each issuing its own document type", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "services"/)
		expect(sql).toContain(`WHERE "c"."code" = 'sanitation'`)
		expect(sql).toContain(`('SANITARY-PERMIT', 'Sanitary Permit', 'sanitary-permit')`)
		expect(sql).toContain(`('SHIP-SANITATION', 'Ship Sanitation Certificate', 'ship-sanitation')`)
	})

	it("switches them off with no fee yet, and with auto-issue off so an officer reviews first", () => {
		const sql = seedSql()
		// fee_centavos, is_active, document_type, auto_issue: nothing goes live by itself.
		expect(sql).toContain(`0, false, "v"."document_type", false`)
	})

	it("publishes one questionnaire for each Service", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "form_templates"/)
		expect(sql).toContain(`'published'`)
		expect(sql).toContain(`WHERE "code" IN ('SANITARY-PERMIT', 'SHIP-SANITATION')`)
	})

	it("asks the questions the Sanitary Permit is built from, the required ones as required", () => {
		const sql = seedSql()
		for (const label of [
			"Establishment name",
			"Type of establishment",
			"Owner or operator",
			"Business address",
		]) {
			expect(sql).toContain(`'text', '${label}', true)`)
		}
		expect(sql).toContain(`'text', 'Contact number', false)`)
	})

	it("asks the questions the Ship Sanitation Certificate is built from, the required ones as required", () => {
		const sql = seedSql()
		for (const label of ["Vessel name", "Registry or IMO number", "Flag or port of registry"]) {
			expect(sql).toContain(`'text', '${label}', true)`)
		}
		for (const label of [
			"Type of vessel",
			"Gross tonnage",
			"Master or agent",
			"Last port of call",
		]) {
			expect(sql).toContain(`'text', '${label}', false)`)
		}
	})

	it("numbers each questionnaire's questions from 0, one position each", () => {
		const sql = seedSql()
		for (const position of [0, 1, 2, 3, 4]) {
			expect(sql.match(new RegExp(`\\('SANITARY-PERMIT', ${position}, '`, "g"))).toHaveLength(1)
		}
		for (const position of [0, 1, 2, 3, 4, 5, 6]) {
			expect(sql.match(new RegExp(`\\('SHIP-SANITATION', ${position}, '`, "g"))).toHaveLength(1)
		}
	})

	it("never edits a Service that already has a questionnaire, and is safe to run again", () => {
		const sql = seedSql()
		expect(sql).toMatch(/ON CONFLICT \("code"\) DO NOTHING;/)
		expect(sql.match(/AND NOT EXISTS \(/g)).toHaveLength(2)
	})
})
