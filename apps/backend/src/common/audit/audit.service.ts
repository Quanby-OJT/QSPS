import { Injectable } from "@nestjs/common"
import { and, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm"

import type {
	AuditLogEntry,
	AuditLogEntryDetail,
	AuditLogFilter,
	AuditOutcome,
	ListAuditLogRequest,
} from "@repo/contracts"
import { auditLog, roles, userRoles, users } from "@repo/db/schema"

import { computeEntryHash, normalizeJson, type ChainedFields } from "@/common/audit/audit-chain"
import { db } from "@/common/database/database.client"
import { currentRequestContext } from "@/common/request-context/request-context"

/**
 * A database handle that may be either the pool or an open transaction.
 *
 * Callers pass their transaction so the audit row commits or rolls back with
 * the mutation it describes. Typed structurally rather than as Drizzle's
 * `PgTransaction` because the pool and a transaction share the query surface
 * used here but not their full types.
 */
export type AuditDb = Pick<typeof db, "insert" | "select" | "execute">

/** Domain tag for RBAC events. Kept here so callers cannot drift on spelling. */
export const AUDIT_DOMAIN_RBAC = "rbac"

/** Domain tag for actions on the audit log itself, such as an export (ADM-3). */
export const AUDIT_DOMAIN_AUDIT = "audit"

/**
 * One event to record.
 *
 * The shape is deliberately generic (domain, action, target, old→new) so every
 * domain can use this trail without a schema change — see the cross-epic
 * ownership rule in DOMAIN-MODEL.md. IP, user agent and the actor's roles are
 * filled in by {@link AuditService.record}, never by the caller.
 */
export interface AuditEvent {
	/** Broad area, e.g. "rbac". For System actions, the job, e.g. "booking.hold-expiry". */
	domain: string
	/** What happened, e.g. "role.assign". */
	action: string
	/** Defaults to "success"; pass "denied" to record a refused attempt. */
	outcome?: AuditOutcome
	/** Who acted. Null only for System actions. */
	actorId: string | null
	targetType?: string | null
	targetId?: string | null
	oldValue?: unknown
	newValue?: unknown
	/** Why it was refused, for denials. */
	reason?: string | null
}

/**
 * Write one chained entry inside `tx`. Module functions rather than private
 * methods, so `AuditService`'s public surface stays record, list and get (the spec
 * checks there is no other way in).
 */
async function appendEntry(event: AuditEvent, tx: AuditDb): Promise<void> {
	// Looked up before the lock below, to keep the time it is held short.
	const actorRole = event.actorId ? await roleNames(event.actorId, tx) : null
	const context = currentRequestContext()

	// One writer at a time, until this transaction ends: two entries must
	// never both chain onto the same previous row. Released automatically on
	// commit or rollback; a rolled-back entry simply never joins the chain.
	await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('qsps.audit_log'))`)

	const [last] = await tx
		.select({ entryHash: auditLog.entryHash })
		.from(auditLog)
		.orderBy(desc(auditLog.id))
		.limit(1)
	// Null for the first entry, and for the first entry after the pre-FND-3 rows.
	const prevHash = last?.entryHash ?? null

	const fields: ChainedFields = {
		domain: event.domain,
		action: event.action,
		outcome: event.outcome ?? "success",
		actorId: event.actorId,
		actorRole,
		targetType: event.targetType ?? null,
		targetId: event.targetId ?? null,
		// Stored exactly as hashed (see normalizeJson).
		oldValue: normalizeJson(event.oldValue),
		newValue: normalizeJson(event.newValue),
		reason: event.reason ?? null,
		ipAddress: context?.ipAddress ?? null,
		userAgent: context?.userAgent ?? null,
		// Set here, not by the database default, so the hash covers the stored value.
		createdAt: new Date(),
	}

	await tx.insert(auditLog).values({
		...fields,
		outcome: fields.outcome as AuditOutcome,
		prevHash,
		entryHash: computeEntryHash(prevHash, fields),
	})
}

/** The actor's role names right now, sorted, e.g. "Cashier, Processing Officer". */
async function roleNames(actorId: string, tx: AuditDb): Promise<string | null> {
	const rows = await tx
		.select({ name: roles.name })
		.from(userRoles)
		.innerJoin(roles, eq(userRoles.roleId, roles.id))
		.where(eq(userRoles.userId, actorId))
	const names = rows.map(row => row.name).sort()
	return names.length > 0 ? names.join(", ") : null
}

/**
 * Append-only, tamper-resistant audit trail (FND-3, TOR §VIII.1).
 *
 * Other domains record events by calling {@link record}; nothing else inserts
 * into the table, so the rules below have a single enforcement point. There is
 * no update or delete method here, and none may be added. The database backs
 * this up: a trigger rejects UPDATE, DELETE and TRUNCATE for every role.
 */
@Injectable()
export class AuditService {
	/**
	 * Append one entry, chained to the entry before it.
	 *
	 * Pass the caller's transaction as `tx` whenever the event describes a
	 * mutation: if the audit insert fails the mutation rolls back with it, so a
	 * change can never commit unrecorded. Without `tx` the entry gets a
	 * transaction of its own, which is correct only for events with nothing to
	 * roll back, such as a denial that rejected before any write.
	 */
	async record(event: AuditEvent, tx?: AuditDb): Promise<void> {
		if (tx) {
			await appendEntry(event, tx)
			return
		}
		await db.transaction(async own => appendEntry(event, own))
	}

	/**
	 * Read entries newest-first, narrowed by the ADM-3 filters.
	 *
	 * Cursor paging on the monotonic id rather than OFFSET: entries are
	 * appended constantly, and OFFSET would silently skip or repeat rows as the
	 * table grows underneath a reader paging through it.
	 */
	async list(query: ListAuditLogRequest): Promise<{
		entries: AuditLogEntry[]
		nextCursor: number | null
	}> {
		const limit = query.limit
		const conditions = filterConditions(query)
		if (query.before) conditions.push(lt(auditLog.id, query.before))

		const rows = await db
			.select(entryColumns())
			.from(auditLog)
			// Left join: an entry outlives the account that produced it, by design.
			.leftJoin(users, eq(auditLog.actorId, users.id))
			.where(and(...conditions))
			// Ordered by id, not createdAt: two rows written in the same
			// transaction share a timestamp, and only the id totally orders them.
			.orderBy(desc(auditLog.id))
			// One extra row tells us whether another page exists without a count.
			.limit(limit + 1)

		const page = rows.slice(0, limit)
		const hasMore = rows.length > limit

		return {
			entries: page.map(toEntry),
			nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
		}
	}

	/** One entry with its hash-chain fields (ADM-3), or null when there is none. */
	async get(id: number): Promise<AuditLogEntryDetail | null> {
		const [row] = await db
			.select({ ...entryColumns(), prevHash: auditLog.prevHash, entryHash: auditLog.entryHash })
			.from(auditLog)
			.leftJoin(users, eq(auditLog.actorId, users.id))
			.where(eq(auditLog.id, id))
			.limit(1)
		if (!row) return null
		return { ...toEntry(row), prevHash: row.prevHash, entryHash: row.entryHash }
	}
}

/**
 * The columns every audit read returns. A function, not a constant: specs
 * that mock `@repo/db/schema` load this file without `auditLog`.
 */
const entryColumns = () => ({
	id: auditLog.id,
	domain: auditLog.domain,
	action: auditLog.action,
	outcome: auditLog.outcome,
	actorId: auditLog.actorId,
	actorEmail: users.email,
	actorRole: auditLog.actorRole,
	targetType: auditLog.targetType,
	targetId: auditLog.targetId,
	oldValue: auditLog.oldValue,
	newValue: auditLog.newValue,
	reason: auditLog.reason,
	ipAddress: auditLog.ipAddress,
	userAgent: auditLog.userAgent,
	createdAt: auditLog.createdAt,
})

function toEntry<T extends { outcome: string; actorEmail: string | null }>(
	row: T
): T & { outcome: AuditOutcome; actorEmail: string | null } {
	return { ...row, outcome: row.outcome as AuditOutcome, actorEmail: row.actorEmail ?? null }
}

/** Manila is UTC+8 all year (no daylight saving), so a business day starts at 16:00 UTC the day before. */
function manilaDayStart(date: string): Date {
	return new Date(`${date}T00:00:00+08:00`)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** `%` and `_` typed by the user are matched literally. */
function likeText(value: string): string {
	return value.replace(/[\\%_]/g, match => `\\${match}`)
}

/** ADM-3: each filter given narrows the result; they combine with AND. */
function filterConditions(filter: AuditLogFilter): SQL[] {
	const conditions: SQL[] = []

	if (filter.from) conditions.push(gte(auditLog.createdAt, manilaDayStart(filter.from)))
	if (filter.to) {
		// `to` is included: stop at the start of the next Manila day.
		conditions.push(lt(auditLog.createdAt, new Date(manilaDayStart(filter.to).getTime() + DAY_MS)))
	}

	if (filter.actor) {
		if (filter.actor.toLowerCase() === "system") {
			conditions.push(isNull(auditLog.actorId))
		} else {
			const byActor = or(
				eq(auditLog.actorId, filter.actor),
				ilike(users.email, `%${likeText(filter.actor)}%`)
			)
			if (byActor) conditions.push(byActor)
		}
	}

	// actor_role holds every role the actor had, e.g. "Cashier, Processing Officer".
	if (filter.role) conditions.push(ilike(auditLog.actorRole, `%${likeText(filter.role)}%`))
	if (filter.domain) conditions.push(eq(auditLog.domain, filter.domain))
	if (filter.action) conditions.push(ilike(auditLog.action, `${likeText(filter.action)}%`))
	if (filter.outcome) conditions.push(eq(auditLog.outcome, filter.outcome))
	if (filter.targetType) conditions.push(eq(auditLog.targetType, filter.targetType))
	if (filter.targetId) conditions.push(eq(auditLog.targetId, filter.targetId))

	return conditions
}