/**
 * `pnpm audit:verify` (FND-3): recompute the audit trail's hash chain and
 * report the first entry changed or removed outside the application.
 *
 * Reads only. Exit code 0 when the chain is intact, 1 when it is broken, 2 when
 * the check could not run. Uses the backend's DATABASE_URL, so it checks
 * whichever database the backend .env points at.
 */
// Load apps/backend/.env first: the env schema below validates on import, and
// outside Nest nothing else reads the file. A missing file is fine (real
// environment variables are used instead, as on a server).
import "dotenv/config"

import { asc, gt } from "drizzle-orm"

import { auditLog } from "@repo/db/schema"

import { ChainVerifier } from "@/common/audit/audit-chain"
import { db } from "@/common/database/database.client"

const PAGE_SIZE = 1000

async function verify(): Promise<number> {
	const verifier = new ChainVerifier()
	let after = 0

	pages: for (;;) {
		const rows = await db
			.select()
			.from(auditLog)
			.where(gt(auditLog.id, after))
			.orderBy(asc(auditLog.id))
			.limit(PAGE_SIZE)
		if (rows.length === 0) break

		for (const row of rows) {
			if (!verifier.add(row)) break pages
		}
		after = rows[rows.length - 1]!.id
	}

	const result = verifier.result()
	if (result.ok) {
		console.log(
			`Audit chain OK: ${result.checked} entries verified, ` +
				`${result.beforeChain} from before the chain started (not hashed).`
		)
		return 0
	}
	console.error(
		`Audit chain BROKEN at entry ${result.brokenId}: it ${result.problem}. ` +
			`${result.checked} entries before it verified.`
	)
	return 1
}

void verify()
	.catch((error: unknown) => {
		console.error("Audit chain check could not run:", error)
		return 2
	})
	.then(async code => {
		await db.$client.end()
		process.exit(code)
	})
