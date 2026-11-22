import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import { ORPCError } from "@orpc/server"
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm"

import type {
	CreatePolicyDocumentInput,
	PolicyDocument,
	PolicyDocumentSummary,
	UpdatePolicyDocumentInput,
} from "@repo/contracts"
import { policyDocuments, services, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { manilaDateOf } from "@/modules/v1/schedules/manila-time"

import {
	loadPoliciesForService,
	versionsInEffect,
	type PolicyDocumentRow,
	type PolicyReader,
} from "./policy-document-rules"

/** Audit domain for admin settings changes, shared with ADM-6. */
const AUDIT_DOMAIN_SETTINGS = "settings"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** What the audit trail keeps of one version: everything but the long text. */
function auditView(row: PolicyDocumentRow) {
	return {
		id: row.id,
		version: row.version,
		title: row.title,
		bodyLength: row.body.length,
		appliesToAllServices: row.appliesToAllServices,
		serviceIds: row.serviceIds,
		effectiveFrom: row.effectiveFrom,
		requiresAcceptance: row.requiresAcceptance,
		withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
	}
}

/**
 * Written policies clients read, and may have to accept, at booking (ADM-9).
 *
 * The only code that writes `policy_documents`. A policy is never edited in
 * place: each change is a new row with the next version, so an acceptance
 * always points at the text the client saw. Withdrawing sets `withdrawn_at`
 * on every version. Every write is audited in the same transaction.
 */
@Injectable()
export class PolicyDocumentService {
	constructor(private readonly auditService: AuditService) {}

	/** The newest version of every policy, withdrawn ones included, for the admin list. */
	async list(now: Date = new Date()): Promise<PolicyDocument[]> {
		const rows = await db.select().from(policyDocuments)
		const byKey = groupByKey(rows)
		const newest = [...byKey.values()].map(versions => versions[0] as PolicyDocumentRow)
		const names = await serviceNames(db, newest)
		const emails = await creatorEmails(newest)
		const today = manilaDateOf(now)

		return newest
			.map(row => toPolicyDocument(row, byKey.get(row.documentKey) ?? [], today, names, emails))
			.sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id)
	}

	/** The version of each policy in effect today, for the public policies page. */
	async published(now: Date = new Date()): Promise<PolicyDocumentSummary[]> {
		const today = manilaDateOf(now)
		const rows = await db
			.select()
			.from(policyDocuments)
			.where(and(isNull(policyDocuments.withdrawnAt), lte(policyDocuments.effectiveFrom, today)))
		const inEffect = versionsInEffect(rows, today)
		const names = await serviceNames(db, inEffect)
		return inEffect.map(row => toSummary(row, names))
	}

	/** The versions a client must read before booking one Service today. */
	async forService(serviceId: number, now: Date = new Date()): Promise<PolicyDocumentSummary[]> {
		const rows = await loadPoliciesForService(db, serviceId, manilaDateOf(now))
		const names = await serviceNames(db, rows)
		return rows.map(row => toSummary(row, names))
	}

	/** Publish a new policy as version 1. */
	async create(
		input: CreatePolicyDocumentInput,
		actorId: string | null,
		now: Date = new Date()
	): Promise<PolicyDocument> {
		const actor = requireActor(actorId)
		checkEffectiveDate(input.effectiveFrom, now)

		const row = await db.transaction(async tx => {
			await checkServicesExist(tx, input.serviceIds)
			const [created] = await tx
				.insert(policyDocuments)
				.values({
					documentKey: randomUUID(),
					version: 1,
					title: input.title,
					body: input.body,
					appliesToAllServices: input.appliesToAllServices,
					serviceIds: input.serviceIds,
					effectiveFrom: input.effectiveFrom,
					requiresAcceptance: input.requiresAcceptance,
					createdBy: actor,
				})
				.returning()
			if (!created) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The policy could not be saved" })
			}
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SETTINGS,
					action: "policy_document.create",
					actorId: actor,
					targetType: "policy_document",
					targetId: created.documentKey,
					oldValue: null,
					newValue: auditView(created),
				},
				tx
			)
			return created
		})

		return this.readBack(row.documentKey, now)
	}

	/**
	 * Publish the next version of a policy. Earlier versions stay, and so do the
	 * acceptances that point at them. A withdrawn policy cannot be edited.
	 */
	async update(
		input: UpdatePolicyDocumentInput,
		actorId: string | null,
		now: Date = new Date()
	): Promise<PolicyDocument> {
		const actor = requireActor(actorId)
		checkEffectiveDate(input.effectiveFrom, now)

		await db.transaction(async tx => {
			const versions = await lockedVersions(tx, input.documentKey)
			const latest = versions[0]
			if (!latest) throw notFound()
			if (latest.withdrawnAt) {
				throw new ORPCError("CONFLICT", {
					message: "This policy was withdrawn. Write a new policy instead.",
				})
			}
			await checkServicesExist(tx, input.serviceIds)

			const [created] = await tx
				.insert(policyDocuments)
				.values({
					documentKey: latest.documentKey,
					version: latest.version + 1,
					title: input.title,
					body: input.body,
					appliesToAllServices: input.appliesToAllServices,
					serviceIds: input.serviceIds,
					effectiveFrom: input.effectiveFrom,
					requiresAcceptance: input.requiresAcceptance,
					createdBy: actor,
				})
				.returning()
			if (!created) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The policy could not be saved" })
			}
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SETTINGS,
					action: "policy_document.version",
					actorId: actor,
					targetType: "policy_document",
					targetId: latest.documentKey,
					oldValue: auditView(latest),
					newValue: auditView(created),
				},
				tx
			)
		})

		return this.readBack(input.documentKey, now)
	}

	/**
	 * Stop a policy from applying to new bookings: `withdrawn_at` on every
	 * version. Earlier acceptances are kept. Withdrawing twice changes nothing.
	 */
	async withdraw(
		documentKey: string,
		actorId: string | null,
		now: Date = new Date()
	): Promise<PolicyDocument> {
		const actor = requireActor(actorId)

		await db.transaction(async tx => {
			const versions = await lockedVersions(tx, documentKey)
			const latest = versions[0]
			if (!latest) throw notFound()
			if (latest.withdrawnAt) return

			await tx
				.update(policyDocuments)
				.set({ withdrawnAt: now })
				.where(eq(policyDocuments.documentKey, documentKey))
			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_SETTINGS,
					action: "policy_document.withdraw",
					actorId: actor,
					targetType: "policy_document",
					targetId: documentKey,
					oldValue: { version: latest.version, withdrawnAt: null },
					newValue: { version: latest.version, withdrawnAt: now.toISOString() },
				},
				tx
			)
		})

		return this.readBack(documentKey, now)
	}

	/** The admin view of one policy, after a write has committed. */
	private async readBack(documentKey: string, now: Date): Promise<PolicyDocument> {
		const policy = (await this.list(now)).find(entry => entry.documentKey === documentKey)
		if (!policy) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The policy could not be read back" })
		}
		return policy
	}
}

function requireActor(actorId: string | null): string {
	if (!actorId) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to manage policies" })
	return actorId
}

function notFound() {
	return new ORPCError("NOT_FOUND", { message: "This policy was not found" })
}

/**
 * A version may start today or later, never in the past: bookings already made
 * would otherwise appear to have skipped it.
 */
function checkEffectiveDate(effectiveFrom: string, now: Date): void {
	if (effectiveFrom < manilaDateOf(now)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The effective date cannot be in the past. Choose today or a later date.",
		})
	}
}

async function checkServicesExist(
	reader: PolicyReader,
	serviceIds: readonly number[]
): Promise<void> {
	if (serviceIds.length === 0) return
	const found = await reader
		.select({ id: services.id })
		.from(services)
		.where(inArray(services.id, [...serviceIds]))
	if (found.length !== serviceIds.length) {
		throw new ORPCError("BAD_REQUEST", { message: "One of the chosen services does not exist" })
	}
}

/**
 * Every version of one policy, newest first, after taking a lock on the key so
 * two editors cannot both write the same next version.
 */
async function lockedVersions(tx: Transaction, documentKey: string): Promise<PolicyDocumentRow[]> {
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtext(${`qsps.policy_document:${documentKey}`}))`
	)
	return tx
		.select()
		.from(policyDocuments)
		.where(eq(policyDocuments.documentKey, documentKey))
		.orderBy(desc(policyDocuments.version))
}

/** Versions grouped by policy, newest first in each group. */
function groupByKey(rows: readonly PolicyDocumentRow[]): Map<string, PolicyDocumentRow[]> {
	const byKey = new Map<string, PolicyDocumentRow[]>()
	for (const row of rows) {
		const versions = byKey.get(row.documentKey) ?? []
		versions.push(row)
		byKey.set(row.documentKey, versions)
	}
	for (const versions of byKey.values()) versions.sort((a, b) => b.version - a.version)
	return byKey
}

async function serviceNames(
	reader: PolicyReader,
	rows: readonly PolicyDocumentRow[]
): Promise<ReadonlyMap<number, string>> {
	const ids = [...new Set(rows.flatMap(row => row.serviceIds))]
	if (ids.length === 0) return new Map()
	const found = await reader
		.select({ id: services.id, name: services.name })
		.from(services)
		.where(inArray(services.id, ids))
	return new Map(found.map(service => [service.id, service.name]))
}

async function creatorEmails(
	rows: readonly PolicyDocumentRow[]
): Promise<ReadonlyMap<string, string>> {
	const ids = [...new Set(rows.map(row => row.createdBy))]
	if (ids.length === 0) return new Map()
	const found = await db
		.select({ id: users.id, email: users.email })
		.from(users)
		.where(inArray(users.id, ids))
	return new Map(found.map(user => [user.id, user.email]))
}

function toSummary(
	row: PolicyDocumentRow,
	names: ReadonlyMap<number, string>
): PolicyDocumentSummary {
	return {
		id: row.id,
		documentKey: row.documentKey,
		version: row.version,
		title: row.title,
		body: row.body,
		requiresAcceptance: row.requiresAcceptance,
		effectiveFrom: row.effectiveFrom,
		appliesToAllServices: row.appliesToAllServices,
		serviceNames: row.appliesToAllServices
			? []
			: row.serviceIds.map(id => names.get(id) ?? `Service ${id}`),
	}
}

function toPolicyDocument(
	latest: PolicyDocumentRow,
	versions: readonly PolicyDocumentRow[],
	today: string,
	names: ReadonlyMap<number, string>,
	emails: ReadonlyMap<string, string>
): PolicyDocument {
	const scheduled = latest.effectiveFrom > today
	return {
		...toSummary(latest, names),
		serviceIds: latest.serviceIds,
		state: latest.withdrawnAt ? "withdrawn" : scheduled ? "scheduled" : "in_effect",
		olderVersionInEffect:
			!latest.withdrawnAt &&
			scheduled &&
			versions.some(version => version.id !== latest.id && version.effectiveFrom <= today),
		withdrawnAt: latest.withdrawnAt,
		createdAt: latest.createdAt,
		createdByEmail: emails.get(latest.createdBy) ?? null,
	}
}
