import { and, isNull, lte } from "drizzle-orm"

import { policyDocuments } from "@repo/db/schema"

import type { db } from "@/common/database/database.client"

/** One stored policy version. */
export type PolicyDocumentRow = typeof policyDocuments.$inferSelect

/** The pool or an open transaction; only `select` is used. */
export type PolicyReader = Pick<typeof db, "select">

/**
 * The version of each policy that applies on `today` (a Manila date,
 * YYYY-MM-DD): the newest version whose effective date has come, of every
 * policy that is not withdrawn (DOMAIN-MODEL `policy_documents`). A newer
 * version waiting for its date leaves the older one in force until then.
 */
export function versionsInEffect(
	rows: readonly PolicyDocumentRow[],
	today: string
): PolicyDocumentRow[] {
	const newest = new Map<string, PolicyDocumentRow>()
	for (const row of rows) {
		if (row.withdrawnAt || row.effectiveFrom > today) continue
		const current = newest.get(row.documentKey)
		if (!current || row.version > current.version) newest.set(row.documentKey, row)
	}
	return [...newest.values()].sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id)
}

/** Whether a version applies to booking one Service. */
export function appliesToService(row: PolicyDocumentRow, serviceId: number): boolean {
	return row.appliesToAllServices || row.serviceIds.includes(serviceId)
}

/**
 * The versions in effect on `today` for one Service, read with `reader` so a
 * booking can check them inside its own transaction.
 */
export async function loadPoliciesForService(
	reader: PolicyReader,
	serviceId: number,
	today: string
): Promise<PolicyDocumentRow[]> {
	const rows = await reader
		.select()
		.from(policyDocuments)
		.where(and(isNull(policyDocuments.withdrawnAt), lte(policyDocuments.effectiveFrom, today)))
	return versionsInEffect(rows, today).filter(row => appliesToService(row, serviceId))
}
