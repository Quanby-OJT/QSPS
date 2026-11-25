import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { FOOD_SAFETY_TRAINING_QUESTIONS } from "./food-safety-training"
import { HACCP_QUESTIONS } from "./haccp"

// document-types -> certificates -> v1 -> modules -> src -> backend -> apps -> repository root
const migrationsDir = join(__dirname, "../../../../../../../packages/db/src/migrations")

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name => name.endsWith("_seed_food_safety"))
	if (!folder) throw new Error("The seed_food_safety migration is missing")
	return readFileSync(join(migrationsDir, folder, "migration.sql"), "utf8")
}

/**
 * The HACCP Certificate and the Food Safety Training Certificate are built from
 * the seeded questionnaires by question label (CRT-6). If a label here and in
 * the seed drift apart, nothing can be issued, so this spec fails first.
 */
describe("food safety questionnaire seed matches the document types (CRT-6)", () => {
	const required = [
		["GMP-HACCP-AUDIT", HACCP_QUESTIONS.establishmentName],
		["GMP-HACCP-AUDIT", HACCP_QUESTIONS.productsOrProcesses],
		["GMP-HACCP-AUDIT", HACCP_QUESTIONS.ownerName],
		["GMP-HACCP-AUDIT", HACCP_QUESTIONS.address],
	] as const

	it.each(required)("%s asks the required question %s", (service, label) => {
		expect(seedSql()).toContain(`('${service}', `)
		expect(seedSql()).toContain(`'text', '${label}', true)`)
	})

	it.each([...Object.values(HACCP_QUESTIONS), ...Object.values(FOOD_SAFETY_TRAINING_QUESTIONS)])(
		"asks the question %s",
		label => {
			expect(seedSql()).toContain(`'${label}'`)
		}
	)
})
