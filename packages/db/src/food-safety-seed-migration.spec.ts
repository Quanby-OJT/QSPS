import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url))

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name => name.endsWith("_seed_food_safety"))
	if (!folder) throw new Error("The seed_food_safety migration is missing")
	return readFileSync(`${migrationsDir}${folder}/migration.sql`, "utf8")
}

describe("food safety seed migration (CRT-6)", () => {
	it("adds the seminar and the audit in the food-safety category, each issuing its own document type", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "services"/)
		expect(sql).toContain(`WHERE "c"."code" = 'food-safety'`)
		expect(sql).toContain(
			`('FOOD-SAFETY-SEMINAR', 'Basic Hygiene and Sanitation Seminar', 'food-safety-training')`
		)
		expect(sql).toContain(`('GMP-HACCP-AUDIT', 'GMP-HACCP Audit', 'haccp')`)
	})

	it("switches them off with no fee yet, and with auto-issue off", () => {
		const sql = seedSql()
		// fee_centavos, is_active, document_type, auto_issue: nothing goes live by itself.
		expect(sql).toContain(`0, false, "v"."document_type", false`)
	})

	it("publishes one questionnaire for each Service", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "form_templates"/)
		expect(sql).toContain(`'published'`)
		expect(sql).toContain(`WHERE "code" IN ('FOOD-SAFETY-SEMINAR', 'GMP-HACCP-AUDIT')`)
	})

	it("asks the questions the HACCP Certificate is built from, the required ones as required", () => {
		const sql = seedSql()
		for (const label of [
			"Establishment name",
			"Products or processes to be audited",
			"Owner or operator",
			"Business address",
		]) {
			expect(sql).toContain(`'text', '${label}', true)`)
		}
		expect(sql).toContain(`'text', 'Contact number', false)`)
	})

	it("asks the seminar's two questions, neither required, so booking a seat stays quick", () => {
		const sql = seedSql()
		expect(sql).toContain(`'text', 'Establishment or employer', false)`)
		expect(sql).toContain(`'text', 'Position or role', false)`)
	})

	it("numbers each questionnaire's questions from 0, one position each", () => {
		const sql = seedSql()
		for (const position of [0, 1]) {
			expect(sql.match(new RegExp(`\\('FOOD-SAFETY-SEMINAR', ${position}, '`, "g"))).toHaveLength(1)
		}
		for (const position of [0, 1, 2, 3, 4]) {
			expect(sql.match(new RegExp(`\\('GMP-HACCP-AUDIT', ${position}, '`, "g"))).toHaveLength(1)
		}
	})

	it("never edits a Service that already has a questionnaire, and is safe to run again", () => {
		const sql = seedSql()
		expect(sql).toMatch(/ON CONFLICT \("code"\) DO NOTHING;/)
		expect(sql.match(/AND NOT EXISTS \(/g)).toHaveLength(2)
	})
})
