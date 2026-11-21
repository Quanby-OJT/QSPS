import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq, sql } from "drizzle-orm"

import { setAuthPolicyReader, type AuthPolicies } from "@repo/auth/auth-policies"
import {
	POLICY_DEFINITIONS,
	validatePolicyValue,
	type Policy,
	type PolicyKey,
	type PolicyValue,
} from "@repo/contracts"
import { policies, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { REDIS_CLIENT, type RedisClient } from "@/common/redis/redis.provider"
import { env } from "@/config/env.config"

/** Audit domain for admin settings changes (ADM-6). */
export const AUDIT_DOMAIN_SETTINGS = "settings"

/** One Redis entry holds every stored value: the table is a handful of rows. */
const CACHE_KEY = "policy:values"

/** Seconds a cached copy may live. An invalidation that fails is bounded by this. */
const CACHE_TTL_SECONDS = 60

type RegisteredDefinition = (typeof POLICY_DEFINITIONS)[number]

type StoredRow = {
	key: string
	value: unknown
	updatedAt: Date
	updatedByEmail: string | null
}

/** The value a key answers with, and whether it is the default. */
type Effective = { value: number | boolean; isDefault: boolean }

/**
 * Env values that replace a key's documented default when set (DOMAIN-MODEL
 * `policies`). Read on every call, not at load, so a spec can change them.
 */
function envDefaults(): Partial<Record<PolicyKey, number | undefined>> {
	return {
		"booking.hold_minutes": env.BOOKING_HOLD_MINUTES,
		"auth.lockout_threshold": env.AUTH_LOCKOUT_THRESHOLD,
		"auth.lockout_minutes": env.AUTH_LOCKOUT_MINUTES,
		"auth.staff_password_max_age_days": env.AUTH_STAFF_PASSWORD_MAX_AGE_DAYS,
	}
}

/**
 * Booking, payment and sign-in Policies (ADM-6, DOMAIN-MODEL section 6).
 *
 * The only code that writes `policies`. Every other epic reads a rule through
 * {@link get}, which answers with the stored value, or the documented default
 * when none is stored. Values are validated against the registry in
 * `@repo/contracts` on write, and again on read, so a stored value that a
 * later release no longer allows falls back to the default instead of
 * reaching the code that uses it.
 *
 * Reads go through one Redis entry with a short TTL. A write clears it after
 * its transaction commits, so every instance sees the change on its next read.
 * Without Redis, or when Redis fails, every read goes to the database: slower,
 * never wrong.
 */
@Injectable()
export class PolicyService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(PolicyService.name)
	/** Keys whose env default was refused, so the warning is logged once. */
	private readonly refusedEnvDefaults = new Set<PolicyKey>()

	constructor(
		private readonly auditService: AuditService,
		@Inject(REDIS_CLIENT) private readonly redis: RedisClient
	) {}

	/** AUTH-3 reads its three Policies through the reader the auth package exposes. */
	onModuleInit(): void {
		setAuthPolicyReader(() => this.authPolicies())
	}

	onModuleDestroy(): void {
		setAuthPolicyReader(null)
	}

	/** The current value of one Policy: the stored value, or its default. */
	async get<K extends PolicyKey>(key: K): Promise<PolicyValue<K>> {
		const stored = await this.storedValues()
		return this.effective(key, stored.get(key)).value as PolicyValue<K>
	}

	/** The values sign-in uses (AUTH-3), read together from one lookup. */
	async authPolicies(): Promise<Partial<AuthPolicies>> {
		const stored = await this.storedValues()
		const value = (key: PolicyKey) => this.effective(key, stored.get(key)).value as number
		return {
			lockoutThreshold: value("auth.lockout_threshold"),
			lockoutMinutes: value("auth.lockout_minutes"),
			staffPasswordMaxAgeDays: value("auth.staff_password_max_age_days"),
		}
	}

	/** The documented default, or the env value that replaces it when it passes the key's rule. */
	defaultValue(key: PolicyKey): number | boolean {
		const definition = definitionOf(key)
		const fromEnv = envDefaults()[key]
		if (fromEnv !== undefined) {
			const checked = validatePolicyValue(key, fromEnv)
			if (checked.ok) return checked.value
			if (!this.refusedEnvDefaults.has(key)) {
				this.refusedEnvDefaults.add(key)
				this.logger.warn(
					`The env default for ${key} (${fromEnv}) is outside its allowed range; ` +
						`using ${String(definition.defaultValue)} instead`
				)
			}
		}
		return definition.defaultValue
	}

	/**
	 * Every registered Policy with its current value, for the policy screen.
	 * Read from the database, not the cache, so the screen shows what is stored.
	 */
	async list(): Promise<Policy[]> {
		const rows: StoredRow[] = await db
			.select({
				key: policies.key,
				value: policies.value,
				updatedAt: policies.updatedAt,
				updatedByEmail: users.email,
			})
			.from(policies)
			.leftJoin(users, eq(policies.updatedBy, users.id))
		const byKey = new Map(rows.map(row => [row.key, row]))
		return POLICY_DEFINITIONS.map(definition =>
			this.toPolicy(definition, byKey.get(definition.key))
		)
	}

	/**
	 * Change one Policy. The value is checked against its key's type and range,
	 * stored, and audited with the old and new value in one transaction; the
	 * cache is cleared once that commits.
	 */
	async set(key: PolicyKey, value: unknown, actorId: string | null): Promise<Policy> {
		if (!actorId) {
			throw new ORPCError("UNAUTHORIZED", { message: "Sign in to change policies" })
		}
		const checked = validatePolicyValue(key, value)
		if (!checked.ok) {
			throw new ORPCError("BAD_REQUEST", { message: checked.message })
		}

		const now = new Date()
		await db.transaction(async tx => {
			// One writer per key at a time, so the old value in the audit entry is
			// the value this change actually replaced. Released on commit or rollback.
			await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`qsps.policy:${key}`}))`)

			const [current] = await tx
				.select({ value: policies.value })
				.from(policies)
				.where(eq(policies.key, key))
			const old = this.effective(key, current?.value)

			await tx
				.insert(policies)
				.values({ key, value: checked.value, updatedBy: actorId, updatedAt: now })
				.onConflictDoUpdate({
					target: policies.key,
					set: { value: checked.value, updatedBy: actorId, updatedAt: now },
				})

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SETTINGS,
					action: "policy.update",
					actorId,
					targetType: "policy",
					targetId: key,
					oldValue: { value: old.value, isDefault: old.isDefault },
					newValue: { value: checked.value },
				},
				tx
			)
		})

		await this.invalidate()

		const policy = (await this.list()).find(entry => entry.key === key)
		if (!policy) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Policy could not be read back" })
		}
		return policy
	}

	private toPolicy(definition: RegisteredDefinition, row: StoredRow | undefined): Policy {
		const current = this.effective(definition.key, row?.value)
		return {
			key: definition.key,
			area: definition.area,
			label: definition.label,
			description: definition.description,
			type: definition.type,
			min: definition.type === "integer" ? definition.min : null,
			max: definition.type === "integer" ? definition.max : null,
			unit: definition.type === "integer" ? definition.unit : null,
			defaultValue: this.defaultValue(definition.key),
			value: current.value,
			isDefault: current.isDefault,
			updatedAt: row?.updatedAt ?? null,
			updatedByEmail: row?.updatedByEmail ?? null,
		}
	}

	/** A stored value that no longer passes its key's rule is ignored, and the default answers. */
	private effective(key: PolicyKey, stored: unknown): Effective {
		if (stored !== undefined) {
			const checked = validatePolicyValue(key, stored)
			if (checked.ok) return { value: checked.value, isDefault: false }
			this.logger.warn(`The stored value for ${key} no longer passes its rule; using the default`)
		}
		return { value: this.defaultValue(key), isDefault: true }
	}

	/** Every stored value, from the cache or the database. */
	private async storedValues(): Promise<ReadonlyMap<string, unknown>> {
		const cached = await this.readCache()
		if (cached) return cached

		const rows = await db.select({ key: policies.key, value: policies.value }).from(policies)
		const values = new Map(rows.map(row => [row.key, row.value]))
		await this.writeCache(values)
		return values
	}

	private async readCache(): Promise<ReadonlyMap<string, unknown> | undefined> {
		if (!this.redis) return undefined
		try {
			const raw = await this.redis.get(CACHE_KEY)
			if (!raw) return undefined
			const parsed: unknown = JSON.parse(raw)
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
			return new Map(Object.entries(parsed))
		} catch {
			// Unreachable or unreadable: the database answers instead.
			return undefined
		}
	}

	/** Fire and forget: a failed write only costs the next read a database query. */
	private async writeCache(values: ReadonlyMap<string, unknown>): Promise<void> {
		if (!this.redis) return
		try {
			await this.redis.set(
				CACHE_KEY,
				JSON.stringify(Object.fromEntries(values)),
				"EX",
				CACHE_TTL_SECONDS
			)
		} catch {
			// Not worth failing the caller over.
		}
	}

	/**
	 * Clear the cache after a change has committed. A failure is logged, not
	 * thrown: the change is already stored, and every instance reads it within
	 * one TTL.
	 */
	private async invalidate(): Promise<void> {
		if (!this.redis) return
		try {
			await this.redis.del(CACHE_KEY)
		} catch (error) {
			this.logger.error(
				`Failed to clear the policy cache; the old values may be served for up to ${CACHE_TTL_SECONDS}s`,
				error instanceof Error ? error.stack : undefined
			)
		}
	}
}

function definitionOf(key: PolicyKey): RegisteredDefinition {
	const definition = POLICY_DEFINITIONS.find(entry => entry.key === key)
	if (!definition) throw new Error(`Policy "${key}" is not registered`)
	return definition
}
