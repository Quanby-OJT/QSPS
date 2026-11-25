import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const migrationsDir = fileURLToPath(new URL("./migrations/", import.meta.url))

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name => name.endsWith("_seed_human_remains_bio"))
	if (!folder) throw new Error("The seed_human_remains_bio migration is missing")
	return readFileSync(`${migrationsDir}${folder}/migration.sql`, "utf8")
}

describe("human remains and biological seed migration (CRT-7)", () => {
	it("adds the three Services in the human-remains-bio category, each issuing its own document type", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "services"/)
		expect(sql).toContain(`WHERE "c"."code" = 'human-remains-bio'`)
		expect(sql).toContain(
			`('HUMAN-REMAINS-TRANSPORT', 'Human Remains Transport Clearance', 'human-remains')`
		)
		expect(sql).toContain(
			`('BIOLOGICAL-CERTIFICATION', 'Biological Substance Certification', 'biological-certification')`
		)
		expect(sql).toContain(
			`('BIOLOGICAL-PERMIT', 'Biological Substance Permit', 'biological-permit')`
		)
	})

	it("switches them off with no fee yet, and with auto-issue off", () => {
		// fee_centavos, is_active, document_type, auto_issue: nothing goes live by itself.
		expect(seedSql()).toContain(`0, false, "v"."document_type", false`)
	})

	it("publishes one questionnaire for each Service", () => {
		const sql = seedSql()
		expect(sql).toMatch(/INSERT INTO "form_templates"/)
		expect(sql).toContain(`'published'`)
		expect(sql).toContain(
			`WHERE "code" IN ('HUMAN-REMAINS-TRANSPORT', 'BIOLOGICAL-CERTIFICATION', 'BIOLOGICAL-PERMIT')`
		)
	})

	it("asks what the Human Remains Certificate is built from, the optional contact number as optional", () => {
		const sql = seedSql()
		for (const label of [
			"Name of the deceased",
			"Date of death",
			"Cause of death",
			"Embalmed or cremated",
			"Consignee name",
			"Consignee address",
			"Origin",
			"Destination",
			"Carrier, flight or vessel",
			"Date of transport",
		]) {
			expect(sql).toContain(`'text', '${label}', true)`)
		}
		expect(sql).toContain(`'text', 'Consignee contact number', false)`)
	})

	it("asks the same questions for the biological certification and the permit", () => {
		const sql = seedSql()
		for (const service of ["BIOLOGICAL-CERTIFICATION", "BIOLOGICAL-PERMIT"]) {
			for (const label of ["Substance or specimen", "Quantity", "Origin", "Destination"]) {
				expect(sql).toContain(`('${service}', `)
				expect(sql).toMatch(new RegExp(`\\('${service}', \\d+, 'text', '${label}', true\\)`))
			}
			for (const label of ["Sender or shipper", "Consignee", "Purpose"]) {
				expect(sql).toMatch(new RegExp(`\\('${service}', \\d+, 'text', '${label}', false\\)`))
			}
		}
	})

	it("numbers each questionnaire's questions from 0, one position each", () => {
		const sql = seedSql()
		const sizes: Record<string, number> = {
			"HUMAN-REMAINS-TRANSPORT": 11,
			"BIOLOGICAL-CERTIFICATION": 7,
			"BIOLOGICAL-PERMIT": 7,
		}
		for (const [service, size] of Object.entries(sizes)) {
			for (let position = 0; position < size; position++) {
				expect(sql.match(new RegExp(`\\('${service}', ${position}, '`, "g"))).toHaveLength(1)
			}
			expect(sql.match(new RegExp(`\\('${service}', ${size}, '`, "g"))).toBeNull()
		}
	})

	it("never edits a Service that already has a questionnaire, and is safe to run again", () => {
		const sql = seedSql()
		expect(sql).toMatch(/ON CONFLICT \("code"\) DO NOTHING;/)
		expect(sql.match(/AND NOT EXISTS \(/g)).toHaveLength(2)
	})
})
