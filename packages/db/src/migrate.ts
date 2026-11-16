/* eslint-disable no-console -- CLI entrypoint: stdout/stderr is this script's only UI. */
import { fileURLToPath } from "node:url"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"

/**
 * Applies every committed migration in `src/migrations` that the target
 * database has not recorded yet, then exits.
 *
 * Deploys run this inside the backend image before the new containers start
 * (`docker compose run --rm --no-deps backend node packages/db/dist/migrate.js`).
 * It uses drizzle-orm's migrator rather than drizzle-kit, which is a dev
 * dependency and is not guaranteed to be in a production image. Both record
 * history in the same `drizzle.__drizzle_migrations` table, so a database
 * migrated by `pnpm db:migrate` and one migrated here never disagree.
 *
 * Safe to re-run: migrations already recorded are skipped. A failure exits
 * non-zero so the deploy stops before any new container starts.
 */
async function runMigrations() {
	const connectionString = process.env.DATABASE_URL

	if (!connectionString) {
		throw new Error("DATABASE_URL environment variable is not set")
	}

	// Resolves to packages/db/src/migrations from both src/ (tsx) and dist/ (node).
	const migrationsFolder = fileURLToPath(new URL("../src/migrations", import.meta.url))

	const pool = new Pool({ connectionString })
	try {
		await migrate(drizzle({ client: pool }), { migrationsFolder })
		console.log("Database migrations are up to date.")
	} finally {
		await pool.end()
	}
}

void runMigrations().catch(error => {
	console.error("Database migration failed.")
	console.error(error)
	process.exitCode = 1
})
