import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { BIOLOGICAL_QUESTIONS } from "./biological-substance"
import { HUMAN_REMAINS_QUESTIONS } from "./human-remains"

// document-types -> certificates -> v1 -> modules -> src -> backend -> apps -> repository root
const migrationsDir = join(__dirname, "../../../../../../../packages/db/src/migrations")

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name => name.endsWith("_seed_human_remains_bio"))
	if (!folder) throw new Error("The seed_human_remains_bio migration is missing")
	return readFileSync(join(migrationsDir, folder, "migration.sql"), "utf8")
}

/**
 * The human remains and biological documents are built from the seeded
 * questionnaires by question label (CRT-7). If a label here and in the seed
 * drift apart, nothing can be issued, so this spec fails first.
 */
describe("human remains and biological questionnaire seed matches the document types (CRT-7)", () => {
	const required = [
		...[
			HUMAN_REMAINS_QUESTIONS.deceasedName,
			HUMAN_REMAINS_QUESTIONS.dateOfDeath,
			HUMAN_REMAINS_QUESTIONS.causeOfDeath,
			HUMAN_REMAINS_QUESTIONS.preparation,
			HUMAN_REMAINS_QUESTIONS.consigneeName,
			HUMAN_REMAINS_QUESTIONS.consigneeAddress,
			HUMAN_REMAINS_QUESTIONS.origin,
			HUMAN_REMAINS_QUESTIONS.destination,
			HUMAN_REMAINS_QUESTIONS.carrier,
			HUMAN_REMAINS_QUESTIONS.transportDate,
		].map(label => ["HUMAN-REMAINS-TRANSPORT", label] as const),
		...["BIOLOGICAL-CERTIFICATION", "BIOLOGICAL-PERMIT"].flatMap(service =>
			[
				BIOLOGICAL_QUESTIONS.substance,
				BIOLOGICAL_QUESTIONS.quantity,
				BIOLOGICAL_QUESTIONS.origin,
				BIOLOGICAL_QUESTIONS.destination,
			].map(label => [service, label] as const)
		),
	]

	it.each(required)("%s asks the required question %s", (service, label) => {
		const sql = seedSql()
		expect(sql).toMatch(new RegExp(`\\('${service}', \\d+, 'text', '${label}', true\\)`))
	})

	it.each([...Object.values(HUMAN_REMAINS_QUESTIONS), ...Object.values(BIOLOGICAL_QUESTIONS)])(
		"asks the question %s",
		label => {
			expect(seedSql()).toContain(`'${label}'`)
		}
	)

	it("asks each biological question in both biological questionnaires", () => {
		const sql = seedSql()
		for (const service of ["BIOLOGICAL-CERTIFICATION", "BIOLOGICAL-PERMIT"]) {
			for (const label of Object.values(BIOLOGICAL_QUESTIONS)) {
				expect(sql).toMatch(
					new RegExp(`\\('${service}', \\d+, 'text', '${label}', (true|false)\\)`)
				)
			}
		}
	})
})
