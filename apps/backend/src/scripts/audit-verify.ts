/**
 * `pnpm audit:verify` (FND-3, OPS-4): recompute the audit trail's hash chain
 * and report the first entry changed or removed outside the application.
 *
 * The chain is walked through every audit archive file first (OPS-4; each file
 * must exist and match its stored checksum), then through the live table, so
 * entries moved by the retention job verify like any other.
 *
 * Reads only. Exit code 0 when the chain is intact, 1 when it is broken, 2 when
 * the check could not run. Uses the backend's .env.
 */
import "dotenv/config"

import { asc, eq, gt } from "drizzle-orm"

import { archiveBatches, auditLog } from "@repo/db/schema"

import { decodeArchive, sha256Hex } from "@/common/archive/archive-rules"
import { toChainedRow, type ArchivedAuditRow } from "@/common/archive/audit-archive-rules"
import { ChainVerifier } from "@/common/audit/audit-chain"
import { db } from "@/common/database/database.client"
import { createFileStorage } from "@/common/storage/storage.module"

const PAGE_SIZE = 1000

function report(verifier: ChainVerifier, archived: number): number {
	const result = verifier.result()
	if (result.ok) {
		console.log(
			`Audit chain OK: ${result.checked} entries verified (${archived} rows read from archive files), ` +
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

async function verify(): Promise<number> {
	const verifier = new ChainVerifier()
	const storage = createFileStorage()
	let archived = 0

	const batches = await db
		.select()
		.from(archiveBatches)
		.where(eq(archiveBatches.dataClass, "audit_log"))
		.orderBy(asc(archiveBatches.firstId))
	for (const batch of batches) {
		const bytes = await storage.read(batch.storageKey)
		if (!bytes) {
			console.error(`Audit archive file ${batch.storageKey} is missing.`)
			return 1
		}
		if (sha256Hex(bytes) !== batch.checksum) {
			console.error(`Audit archive file ${batch.storageKey} does not match its stored checksum.`)
			return 1
		}
		for (const row of decodeArchive(bytes) as ArchivedAuditRow[]) {
			if (!verifier.add(toChainedRow(row))) return report(verifier, archived)
			archived++
		}
	}

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
	return report(verifier, archived)
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
