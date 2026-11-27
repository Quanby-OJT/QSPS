import { Inject, Injectable } from "@nestjs/common"
import { and, desc, eq, gte, inArray, lt, type SQL } from "drizzle-orm"

import type {
	ArchivedAuditLogEntry,
	ArchivedAuditLogResponse,
	AuditLogFilter,
} from "@repo/contracts"
import { archiveBatches, users } from "@repo/db/schema"

import { db } from "@/common/database/database.client"
import { FILE_STORAGE, type FileStorage } from "@/common/storage/file-storage"

import { decodeArchive, sha256Hex } from "./archive-rules"
import {
	auditFilterRange,
	matchesAuditFilter,
	toArchivedEntry,
	type ArchivedAuditRow,
} from "./audit-archive-rules"

/** Most matches returned in one search. */
export const MAX_ARCHIVED_RESULTS = 500
/** Most archive files read in one search; narrow the dates to reach older ones. */
export const MAX_ARCHIVE_FILES_PER_SEARCH = 24

async function emailsOf(rows: readonly ArchivedAuditRow[]): Promise<ReadonlyMap<string, string>> {
	const ids = [...new Set(rows.map(row => row.actorId).filter((id): id is string => id !== null))]
	if (ids.length === 0) return new Map()
	const found = await db
		.select({ id: users.id, email: users.email })
		.from(users)
		.where(inArray(users.id, ids))
	return new Map(found.map(user => [user.id, user.email]))
}

/**
 * Searches archived audit entries (OPS-4). Reads only: the files whose range
 * overlaps the filter's dates, newest first, each checked against its stored
 * checksum. A file that is missing or does not match is counted, never used.
 */
@Injectable()
export class AuditArchiveService {
	constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

	async search(filter: AuditLogFilter): Promise<ArchivedAuditLogResponse> {
		const { from, toExclusive } = auditFilterRange(filter)
		const conditions: SQL[] = [eq(archiveBatches.dataClass, "audit_log")]
		if (from) conditions.push(gte(archiveBatches.rangeTo, from))
		if (toExclusive) conditions.push(lt(archiveBatches.rangeFrom, toExclusive))

		const batches = await db
			.select()
			.from(archiveBatches)
			.where(and(...conditions))
			.orderBy(desc(archiveBatches.lastId))
			.limit(MAX_ARCHIVE_FILES_PER_SEARCH + 1)

		let truncated = batches.length > MAX_ARCHIVE_FILES_PER_SEARCH
		let unreadableFiles = 0
		const entries: ArchivedAuditLogEntry[] = []

		files: for (const batch of batches.slice(0, MAX_ARCHIVE_FILES_PER_SEARCH)) {
			const bytes = await this.storage.read(batch.storageKey)
			if (!bytes || sha256Hex(bytes) !== batch.checksum) {
				unreadableFiles++
				continue
			}
			const rows = (decodeArchive(bytes) as ArchivedAuditRow[]).reverse()
			const emails = await emailsOf(rows)
			for (const row of rows) {
				const entry = toArchivedEntry(row, row.actorId ? (emails.get(row.actorId) ?? null) : null)
				if (!matchesAuditFilter(entry, filter)) continue
				if (entries.length === MAX_ARCHIVED_RESULTS) {
					truncated = true
					break files
				}
				entries.push(entry)
			}
		}

		return { entries, truncated, unreadableFiles }
	}
}
