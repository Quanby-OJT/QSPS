import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { PERMISSION_NAMES, ROLE_NAMES, ROLE_PERMISSIONS } from "@repo/contracts"

/**
 * FND-2a: staging and production get the RBAC catalog only from migrations
 * (`pnpm db:seed` refuses non-local databases). This test fails when
 * ROLE_PERMISSIONS gains a key, a role, or a grant that no migration inserts,
 * so a catalog change cannot ship without its migration.
 *
 * It reads every migration, not one file, so a later catalog change can ship
 * as a new migration in the same format.
 */
const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url))

const allMigrationSql = readdirSync(migrationsDir, { withFileTypes: true })
	.filter(entry => entry.isDirectory())
	.map(entry => readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf8"))
	.join("\n")

describe("RBAC catalog migration", () => {
	it("inserts every permission key from the catalog", () => {
		const missing = PERMISSION_NAMES.filter(name => !allMigrationSql.includes(`('${name}', `))
		expect(missing).toEqual([])
	})

	it("inserts every role from the catalog", () => {
		const missing = ROLE_NAMES.filter(name => !allMigrationSql.includes(`('${name}', `))
		expect(missing).toEqual([])
	})

	it("inserts every role grant from ROLE_PERMISSIONS", () => {
		const missing = ROLE_NAMES.flatMap(role =>
			ROLE_PERMISSIONS[role]
				.filter(permission => !allMigrationSql.includes(`('${role}', '${permission}')`))
				.map(permission => `${role} -> ${permission}`)
		)
		expect(missing).toEqual([])
	})

	it("never overwrites existing rows", () => {
		// Insert-only: a role an admin edited after deploy must survive later
		// migrations. Any UPDATE or DELETE on the RBAC tables would break that.
		expect(allMigrationSql).not.toMatch(
			/\b(UPDATE|DELETE FROM)\s+"(roles|permissions|role_permissions)"/i
		)
	})
})
