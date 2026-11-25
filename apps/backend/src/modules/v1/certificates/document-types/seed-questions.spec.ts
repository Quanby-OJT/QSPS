import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { SANITARY_PERMIT_QUESTIONS } from "./sanitary-permit"
import { SHIP_SANITATION_QUESTIONS } from "./ship-sanitation"

// document-types -> certificates -> v1 -> modules -> src -> backend -> apps -> repository root
const migrationsDir = join(__dirname, "../../../../../../../packages/db/src/migrations")

function seedSql(): string {
	const folder = readdirSync(migrationsDir).find(name => name.endsWith("_seed_sanitation"))
	if (!folder) throw new Error("The seed_sanitation migration is missing")
	return readFileSync(join(migrationsDir, folder, "migration.sql"), "utf8")
}

/**
 * The permit and the certificate are built from the seeded questionnaires by
 * question label (CRT-5). If a label here and in the seed drift apart, nothing
 * can be issued, so this spec fails first.
 */
describe("sanitation questionnaire seed matches the document types (CRT-5)", () => {
	const required = [
		["SANITARY-PERMIT", SANITARY_PERMIT_QUESTIONS.establishmentName],
		["SANITARY-PERMIT", SANITARY_PERMIT_QUESTIONS.establishmentType],
		["SANITARY-PERMIT", SANITARY_PERMIT_QUESTIONS.ownerName],
		["SANITARY-PERMIT", SANITARY_PERMIT_QUESTIONS.address],
		["SHIP-SANITATION", SHIP_SANITATION_QUESTIONS.vesselName],
		["SHIP-SANITATION", SHIP_SANITATION_QUESTIONS.registryNumber],
		["SHIP-SANITATION", SHIP_SANITATION_QUESTIONS.registryPort],
	] as const

	it.each(required)("%s asks the required question %s", (service, label) => {
		expect(seedSql()).toContain(`('${service}', `)
		expect(seedSql()).toContain(`'text', '${label}', true)`)
	})

	it.each([
		...Object.values(SANITARY_PERMIT_QUESTIONS),
		...Object.values(SHIP_SANITATION_QUESTIONS),
	])("asks the question %s", label => {
		expect(seedSql()).toContain(`'${label}'`)
	})
})
