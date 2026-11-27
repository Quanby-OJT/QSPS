import { createHash } from "node:crypto"

/**
 * The hash chain behind the tamper-resistant audit trail (FND-3).
 *
 * Each row stores `entry_hash = sha256(prev_hash + its fields)`. Changing any
 * field, or removing a row, breaks the link to the next row, and
 * {@link verifyChain} reports the first row where that happens. Pure functions
 * only, so the service, the `audit:verify` command and the tests all hash the
 * same way.
 */

/** Bump only with a migration plan: every existing hash was computed with this version. */
const CHAIN_VERSION = 1

/** The fields an entry's hash covers. `id` is left out: the chain itself orders rows. */
export interface ChainedFields {
	domain: string
	action: string
	outcome: string
	actorId: string | null
	actorRole: string | null
	targetType: string | null
	targetId: string | null
	oldValue: unknown
	newValue: unknown
	reason: string | null
	ipAddress: string | null
	userAgent: string | null
	createdAt: Date
}

/** One stored row as `verifyChain` reads it. */
export interface ChainedRow extends ChainedFields {
	id: number
	prevHash: string | null
	entryHash: string | null
}

/**
 * The value Postgres will hand back for a jsonb column: a JSON round trip
 * drops `undefined`, turns Dates into strings and so on. `record` stores this
 * normalised value, so what was hashed is exactly what is stored.
 */
export function normalizeJson(value: unknown): unknown {
	if (value === undefined || value === null) return null
	return JSON.parse(JSON.stringify(value)) as unknown
}

/** Sort object keys at every level: jsonb does not keep key order, so the hash must not depend on it. */
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical)
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map(key => [key, canonical(record[key])])
		)
	}
	return value
}

/** sha256 (hex) of the previous hash plus this entry's fields. */
export function computeEntryHash(prevHash: string | null, fields: ChainedFields): string {
	const payload = canonical({
		v: CHAIN_VERSION,
		prevHash,
		domain: fields.domain,
		action: fields.action,
		outcome: fields.outcome,
		actorId: fields.actorId,
		actorRole: fields.actorRole,
		targetType: fields.targetType,
		targetId: fields.targetId,
		oldValue: normalizeJson(fields.oldValue),
		newValue: normalizeJson(fields.newValue),
		reason: fields.reason,
		ipAddress: fields.ipAddress,
		userAgent: fields.userAgent,
		createdAt: fields.createdAt.toISOString(),
	})
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export type ChainCheck =
	| { ok: true; checked: number; beforeChain: number }
	| { ok: false; checked: number; beforeChain: number; brokenId: number; problem: string }

/**
 * Walk rows in id order and check every link. Rows with neither hash at the
 * start are from before FND-3 and are only counted. After the first hashed
 * row, every row must carry a hash, point at the row before it, and still
 * produce its own hash.
 */
export class ChainVerifier {
	private expectedPrev: string | null = null
	private started = false
	private checked = 0
	private beforeChain = 0
	private failure: { brokenId: number; problem: string } | null = null

	/** startHash: entryHash of the last archived row, when older rows were archived. */
	constructor(startHash: string | null = null) {
		this.expectedPrev = startHash
		this.started = startHash !== null
	}

	/** Feed the next row. Returns false once a break is found; stop feeding then. */
	add(row: ChainedRow): boolean {
		if (this.failure) return false

		if (!this.started) {
			if (row.entryHash === null && row.prevHash === null) {
				this.beforeChain++
				return true
			}
			this.started = true
		}

		if (row.entryHash === null) {
			return this.fail(row.id, "has no hash, but entries before it do")
		}
		if (row.prevHash !== this.expectedPrev) {
			return this.fail(
				row.id,
				"does not link to the entry before it (an entry was removed or reordered)"
			)
		}
		if (computeEntryHash(row.prevHash, row) !== row.entryHash) {
			return this.fail(row.id, "was changed after it was written")
		}

		this.expectedPrev = row.entryHash
		this.checked++
		return true
	}

	result(): ChainCheck {
		return this.failure
			? { ok: false, checked: this.checked, beforeChain: this.beforeChain, ...this.failure }
			: { ok: true, checked: this.checked, beforeChain: this.beforeChain }
	}

	private fail(brokenId: number, problem: string): false {
		this.failure = { brokenId, problem }
		return false
	}
}

/** Check a whole list of rows at once (tests and small tables). */
export function verifyChain(
	rows: Iterable<ChainedRow>,
	startHash: string | null = null
): ChainCheck {
	const verifier = new ChainVerifier(startHash)
	for (const row of rows) {
		if (!verifier.add(row)) break
	}
	return verifier.result()
}
