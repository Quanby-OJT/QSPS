import { createHash } from "node:crypto"
import { gunzipSync, gzipSync } from "node:zlib"

import type { PolicyKey } from "@repo/contracts"

/** Live tables the retention job may archive (OPS-4). sync_operations joins with OFF-2. */
export const ARCHIVE_CLASSES = ["audit_log", "notifications", "payment_events"] as const

export type ArchiveClass = (typeof ARCHIVE_CLASSES)[number]

/** The Policy that holds each class's retention period, in days (0 = never archive). */
export const RETENTION_POLICY = {
	audit_log: "retention.audit_log_days",
	notifications: "retention.notifications_days",
	payment_events: "retention.payment_events_days",
} as const satisfies Record<ArchiveClass, PolicyKey>

/** The most rows one run moves per class; the rest wait for the next night. */
export const MAX_ROWS_PER_RUN = 10_000

const DAY_MS = 24 * 60 * 60 * 1000

/** Rows created before this instant are due; null when the period is 0 (never archive). */
export function retentionCutoff(now: Date, days: number): Date | null {
	if (!Number.isInteger(days) || days <= 0) return null
	return new Date(now.getTime() - days * DAY_MS)
}

/** archive/<class>/<UTC run time>-<first id>-<last id>.jsonl.gz: unique per run and range. */
export function archiveKey(
	dataClass: ArchiveClass,
	now: Date,
	firstId: number,
	lastId: number
): string {
	const stamp = now
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z")
	return `archive/${dataClass}/${stamp}-${firstId}-${lastId}.jsonl.gz`
}

/** One JSON object per line, gzipped. Dates become ISO text, as in the API. */
export function encodeArchive(rows: readonly unknown[]): Uint8Array {
	const text = rows.map(row => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "")
	return new Uint8Array(gzipSync(Buffer.from(text, "utf8")))
}

export function decodeArchive(bytes: Uint8Array): unknown[] {
	return gunzipSync(bytes)
		.toString("utf8")
		.split("\n")
		.filter(line => line.length > 0)
		.map(line => JSON.parse(line) as unknown)
}

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex")
}
