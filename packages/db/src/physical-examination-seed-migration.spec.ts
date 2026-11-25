import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url))

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name =>
		name.endsWith("_seed_physical_examination")
	)
	if (!folder) throw new Error("The seed_physical_examination migration is missing")
	return readFileSync(`${migrationsDir}${folder}/migration.sql`, "utf8")
}

describe("physical examination seed migration (CRT-4)", () => {
	it("adds the Physical Examination Service in its category, switched off with no fee yet", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "services"/)
		expect(sql).toContain(`WHERE "code" = 'physical-exam'`)
		// Code, name, fee in centavos, is_active: nothing goes live by itself.
		expect(sql).toContain(`'PHYSICAL-EXAM', 'Physical Examination', 0, false`)
	})

	it("publishes a questionnaire that asks whether the applicant is Local or Foreign", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "form_templates"/)
		expect(sql).toContain(`'published'`)
		// The application form is chosen from this exact question and these answers.
		expect(sql).toContain(`'single_choice', 'Applicant type', true, '["Local","Foreign"]'::jsonb`)
	})

	it("numbers the questions from 0, one position each", () => {
		const sql = seedSql()
		for (const position of [0, 1, 2, 3]) {
			expect(sql.match(new RegExp(`\\(${position}, '`, "g"))).toHaveLength(1)
		}
	})

	it("never edits a Service that already has a questionnaire, and is safe to run again", () => {
		const sql = seedSql()
		expect(sql).toMatch(/ON CONFLICT \("code"\) DO NOTHING;/)
		expect(sql.match(/AND NOT EXISTS \(/g)).toHaveLength(2)
	})
})