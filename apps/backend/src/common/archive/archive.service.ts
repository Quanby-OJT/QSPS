import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { and, asc, inArray, lt, sql } from "drizzle-orm"

import { archiveBatches, auditLog, notifications, paymentEvents } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { PolicyService } from "@/common/policy/policy.service"
import { FILE_STORAGE, type FileStorage } from "@/common/storage/file-storage"

import {
	ARCHIVE_CLASSES,
	archiveKey,
	decodeArchive,
	encodeArchive,
	MAX_ROWS_PER_RUN,
	RETENTION_POLICY,
	retentionCutoff,
	sha256Hex,
	type ArchiveClass,
} from "./archive-rules"

/** The no-login role the FND-3 trigger lets delete audit entries (OPS-4 migration). */
export const ARCHIVER_ROLE = "qsps_archiver"

const AUDIT_DOMAIN_ARCHIVE = "archive"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ArchivedRow = Record<string, unknown> & { id: number; createdAt: Date }

export type ArchiveClassResult =
	| { dataClass: ArchiveClass; status: "off" | "nothing" }
	| { dataClass: ArchiveClass; status: "skipped"; reason: string }
	| {
			dataClass: ArchiveClass
			status: "archived"
			rowCount: number
			storageKey: string
			checksum: string
	  }
	| { dataClass: ArchiveClass; status: "failed"; error: string }

async function selectDue(
	dataClass: ArchiveClass,
	cutoff: Date,
	limit: number
): Promise<ArchivedRow[]> {
	switch (dataClass) {
		case "audit_log":
			return db
				.select()
				.from(auditLog)
				.where(lt(auditLog.createdAt, cutoff))
				.orderBy(asc(auditLog.id))
				.limit(limit)
		case "notifications":
			return db
				.select()
				.from(notifications)
				.where(
					and(
						lt(notifications.createdAt, cutoff),
						inArray(notifications.status, ["sent", "failed"])
					)
				)
				.orderBy(asc(notifications.id))
				.limit(limit)
		case "payment_events":
			return db
				.select()
				.from(paymentEvents)
				.where(lt(paymentEvents.createdAt, cutoff))
				.orderBy(asc(paymentEvents.id))
				.limit(limit)
	}
}

/** Deletes exactly these ids and returns how many went. */
async function deleteIds(tx: Transaction, dataClass: ArchiveClass, ids: number[]): Promise<number> {
	switch (dataClass) {
		case "audit_log":
			return (
				await tx.delete(auditLog).where(inArray(auditLog.id, ids)).returning({ id: auditLog.id })
			).length
		case "notifications":
			return (
				await tx
					.delete(notifications)
					.where(inArray(notifications.id, ids))
					.returning({ id: notifications.id })
			).length
		case "payment_events":
			return (
				await tx
					.delete(paymentEvents)
					.where(inArray(paymentEvents.id, ids))
					.returning({ id: paymentEvents.id })
			).length
	}
}

/** Whether this connection may switch to the archiver role (it exists, and we are a member or superuser). */
async function canUseArchiverRole(): Promise<boolean> {
	const result = await db.execute(
		sql`select exists (select 1 from pg_roles where rolname = ${ARCHIVER_ROLE})
      and (r.rolsuper or exists (
        select 1 from pg_auth_members m join pg_roles a on a.oid = m.roleid
        where a.rolname = ${ARCHIVER_ROLE} and m.member = r.oid
      )) as ok
      from pg_roles r where r.rolname = current_user`
	)
	const row = result.rows[0] as { ok?: boolean } | undefined
	return row?.ok === true
}

/**
 * Data retention and archiving (OPS-4, TOR IX.C, VIII.1).
 *
 * Nightly, for each class whose retention Policy is above 0, the oldest rows
 * created before the period are written to one gzip JSON-lines file in
 * FileStorage. The file is read back and its sha256 and row count checked;
 * only then, in one transaction, are exactly those rows deleted from the live
 * table, the batch recorded in `archive_batches` and an `archive.run` Audit
 * Entry written. Archive files are never deleted or overwritten here.
 *
 * Audit entries are deleted only under the `qsps_archiver` role, the one
 * exception the FND-3 trigger allows; without that role the class is skipped.
 */
@Injectable()
export class ArchiveService {
	private readonly logger = new Logger(ArchiveService.name)

	constructor(
		@Inject(FILE_STORAGE) private readonly storage: FileStorage,
		private readonly auditService: AuditService,
		private readonly policyService: PolicyService
	) {}

	@Cron("0 2 * * *", { name: "data-archive", timeZone: "Asia/Manila" })
	async run(): Promise<void> {
		// A cron callback has no caller: log, never throw.
		try {
			for (const result of await this.archiveDue()) {
				if (result.status === "off" || result.status === "nothing") continue
				this.logger.log({ event: "archive.result", ...result })
			}
		} catch (error) {
			this.logger.error("Archive run failed", error instanceof Error ? error.stack : undefined)
		}
	}

	/** Every class in turn; one failing class does not stop the others. */
	async archiveDue(now: Date = new Date()): Promise<ArchiveClassResult[]> {
		const results: ArchiveClassResult[] = []
		for (const dataClass of ARCHIVE_CLASSES) {
			try {
				results.push(await this.archiveClass(dataClass, now))
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				this.logger.error({ event: "archive.failed", dataClass, error: message })
				results.push({ dataClass, status: "failed", error: message })
			}
		}
		return results
	}

	async archiveClass(dataClass: ArchiveClass, now: Date): Promise<ArchiveClassResult> {
		const days = await this.policyService.get(RETENTION_POLICY[dataClass])
		const cutoff = retentionCutoff(now, days)
		if (!cutoff) return { dataClass, status: "off" }

		if (dataClass === "audit_log" && !(await canUseArchiverRole())) {
			return {
				dataClass,
				status: "skipped",
				reason: `the ${ARCHIVER_ROLE} database role is not set up for this connection`,
			}
		}

		const rows = await selectDue(dataClass, cutoff, MAX_ROWS_PER_RUN)
		const first = rows[0]
		const last = rows[rows.length - 1]
		if (!first || !last) return { dataClass, status: "nothing" }

		const storageKey = archiveKey(dataClass, now, first.id, last.id)
		if (await this.storage.exists(storageKey)) {
			throw new Error(`Archive file ${storageKey} already exists; nothing was removed`)
		}
		const bytes = encodeArchive(rows)
		const checksum = sha256Hex(bytes)
		await this.storage.put(storageKey, bytes, "application/gzip")

		const stored = await this.storage.read(storageKey)
		if (!stored || sha256Hex(stored) !== checksum || decodeArchive(stored).length !== rows.length) {
			throw new Error(`Archive file ${storageKey} did not verify; nothing was removed`)
		}

		const ids = rows.map(row => row.id)
		const times = rows.map(row => row.createdAt.getTime())
		const rangeFrom = new Date(Math.min(...times))
		const rangeTo = new Date(Math.max(...times))
		const chainTailHash =
			dataClass === "audit_log" && typeof last.entryHash === "string" ? last.entryHash : null

		await db.transaction(async tx => {
			if (dataClass === "audit_log") await tx.execute(sql.raw(`SET LOCAL ROLE ${ARCHIVER_ROLE}`))
			const removed = await deleteIds(tx, dataClass, ids)
			if (dataClass === "audit_log") await tx.execute(sql.raw("RESET ROLE"))
			if (removed !== ids.length) {
				throw new Error(
					`Expected to remove ${ids.length} ${dataClass} rows but removed ${removed}; rolled back`
				)
			}

			await tx.insert(archiveBatches).values({
				dataClass,
				rangeFrom,
				rangeTo,
				firstId: first.id,
				lastId: last.id,
				rowCount: rows.length,
				storageKey,
				checksum,
				chainTailHash,
				createdAt: now,
			})
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_ARCHIVE,
					action: "archive.run",
					actorId: null,
					targetType: "archive_batch",
					targetId: storageKey,
					newValue: {
						dataClass,
						rangeFrom: rangeFrom.toISOString(),
						rangeTo: rangeTo.toISOString(),
						firstId: first.id,
						lastId: last.id,
						rowCount: rows.length,
						checksum,
					},
				},
				tx
			)
		})

		return { dataClass, status: "archived", rowCount: rows.length, storageKey, checksum }
	}
}
