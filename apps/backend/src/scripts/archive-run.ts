/**
 * `pnpm --filter @repo/backend archive:run` (OPS-4): run the nightly retention
 * job once, now, against the database in apps/backend/.env, and print what each
 * class did. Uses the stored retention Policies; with every period at 0 it
 * changes nothing.
 */
import "dotenv/config"

import { ArchiveService } from "@/common/archive/archive.service"
import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { PolicyService } from "@/common/policy/policy.service"
import { createFileStorage } from "@/common/storage/storage.module"

async function main(): Promise<number> {
	const audit = new AuditService()
	const policies = new PolicyService(audit, null)
	const results = await new ArchiveService(createFileStorage(), audit, policies).archiveDue()
	console.log(JSON.stringify(results, null, 2))
	return results.some(result => result.status === "failed") ? 1 : 0
}

void main()
	.catch((error: unknown) => {
		console.error("Archive run could not start:", error)
		return 2
	})
	.then(async code => {
		await db.$client.end()
		process.exit(code)
	})
