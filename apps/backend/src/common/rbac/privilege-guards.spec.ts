/**
 * Privilege-tier collapse and last-Admin protection.
 *
 * Against a real Postgres, because both guarantees are transactional: the
 * last-Admin count must be taken under a row lock inside the same transaction
 * as the removal, and the check-then-write race this closes only exists between concurrent
 * database transactions. A mocked db cannot exhibit it, so a mocked test could
 * not catch its return.
 *
 * Skips when Postgres is unreachable, and when it is up but `pnpm db:push` has
 * not created the relations this file uses. A table that exists still runs.
 * When those relations exist but the seeded Super Admin role is missing, every case
 * skips and the message names `pnpm db:seed`. An Admin row that is present
 * still runs.
 */

import { and, desc, eq, gt } from "drizzle-orm"

import { auditLog, roles, userRoles, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { RbacCacheService } from "@/common/rbac/rbac-cache.service"
import { RbacService } from "@/common/rbac/rbac.service"
import { bindDbBackedTests, bindSeededCases } from "@/testing/db-ready"

jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Super Admin",
	PERMISSION_NAMES: ["users.accounts:read", "users.roles:manage"],
}))

// `RbacService` refuses with `ORPCError` so oRPC maps the denial to 403/409
// instead of a 500. `@orpc/server` is ESM and this jest config does not
// transform it, so the stub stands in — it keeps the `code`, which is exactly
// what the status assertions below read.
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public code: string,
			options?: { message?: string }
		) {
			super(options?.message ?? code)
			this.name = "ORPCError"
		}
	},
}))

// audit_log is append-only (FND-3), so these fixtures cannot be wiped between
// runs: each run uses its own ids, and audit reads only look at rows written
// after the current test started (`since`). The users stay in the local
// database, because a user with audit entries cannot be deleted, by design.
const RUN = Date.now().toString(36)
const MANAGER = `az2-manager-${RUN}` // holds users.roles:manage, NOT Super Admin
const ADMIN_A = `az2-admin-a-${RUN}`
const ADMIN_B = `az2-admin-b-${RUN}`
const SUBJECT = `az2-subject-${RUN}`
const ALL_USERS = [MANAGER, ADMIN_A, ADMIN_B, SUBJECT]

const dbTests = bindDbBackedTests({
	label: "az-2",
	relations: ["users", "roles", "user_roles", "audit_log"],
	database: db,
})
const adminSeed = bindSeededCases({
	label: "az-2",
	rows: ["Super Admin"],
	itDb: dbTests.itDb,
})
const itDb = adminSeed.itDb
let adminRoleId: number
/** Real Admin memberships, set aside for the duration of this suite. */
let preexistingAdmins: { userId: string; roleId: number }[] = []

/** Removes the fixtures' role memberships. Audit rows, and the users they name, stay. */
async function cleanup() {
	for (const id of ALL_USERS) {
		await db.delete(userRoles).where(eq(userRoles.userId, id))
	}
}

/** Highest audit id so far; a test reads only rows above the value it took at its start. */
async function latestAuditId(): Promise<number> {
	const [row] = await db
		.select({ id: auditLog.id })
		.from(auditLog)
		.orderBy(desc(auditLog.id))
		.limit(1)
	return row?.id ?? 0
}

let since = 0

/** Reset Admin membership to exactly the given users. */
async function setAdmins(ids: string[]) {
	for (const id of ALL_USERS) {
		await db
			.delete(userRoles)
			.where(and(eq(userRoles.userId, id), eq(userRoles.roleId, adminRoleId)))
	}
	if (ids.length) {
		await db.insert(userRoles).values(ids.map(id => ({ userId: id, roleId: adminRoleId })))
	}
}

/** How many users hold Admin, counting only this test's fixtures. */
async function adminCount(): Promise<number> {
	const rows = await db.select().from(userRoles).where(eq(userRoles.roleId, adminRoleId))
	return rows.filter(r => ALL_USERS.includes(r.userId)).length
}

function makeService() {
	return new RbacService(new RbacCacheService(null), new AuditService())
}

/** Denials by `actorId` written during the current test. */
async function denialsFor(actorId: string) {
	const rows = await db
		.select()
		.from(auditLog)
		.where(and(eq(auditLog.actorId, actorId), gt(auditLog.id, since)))
		.orderBy(auditLog.id)
	return rows.filter(r => r.outcome === "denied")
}

beforeAll(async () => {
	await dbTests.probe()
	if (!dbTests.ready) return

	const [admin] = await db.select().from(roles).where(eq(roles.name, "Super Admin"))
	// Super Admin is inserted by `pnpm db:seed`, not by `pnpm db:push`.
	if (!admin) {
		adminSeed.markMissing()
		return
	}
	adminRoleId = admin.id

	await cleanup()

	const now = new Date()
	await db.insert(users).values(
		ALL_USERS.map(id => ({
			id,
			name: id,
			email: `${id}@test.local`,
			createdAt: now,
			updatedAt: now,
		}))
	)

	// "Last Admin" is a global condition, so the fixtures have to be the only
	// holders while these tests run. Real memberships are set aside and put
	// back in afterAll — deleting them outright would strip the seeded admin
	// of its role and quietly break every later e2e run against this database.
	preexistingAdmins = await db.select().from(userRoles).where(eq(userRoles.roleId, adminRoleId))
	await db.delete(userRoles).where(eq(userRoles.roleId, adminRoleId))
})

beforeEach(async () => {
	if (dbTests.ready && !adminSeed.missing) since = await latestAuditId()
})

afterAll(async () => {
	if (!dbTests.connected) return
	if (!dbTests.ready || adminSeed.missing) {
		// select 1 succeeded, so the pool is open. The relations are missing,
		// or the Admin seed row is, and no fixture rows were written. Close
		// the pool without touching tables.
		await db.$client.end()
		return
	}

	try {
		await cleanup()
	} finally {
		// Restore what was here before, exactly — even if cleanup failed.
		// A crash here once left the seeded admin without Super Admin.
		await db.delete(userRoles).where(eq(userRoles.roleId, adminRoleId))
		if (preexistingAdmins.length) {
			await db.insert(userRoles).values(preexistingAdmins).onConflictDoNothing()
		}
		await db.$client.end()
	}
})

describe("Admin grants require Admin", () => {
	beforeEach(async () => {
		if (!dbTests.ready || adminSeed.missing) return
		await setAdmins([ADMIN_A])
	})

	itDb("refuses a users.roles:manage holder granting Super Admin to themselves", async () => {
		// The self-escalation this ticket exists to stop: the permission that
		// lets you manage users must not be the permission that lets you become
		// anyone.
		await expect(makeService().assignRole(MANAGER, "Super Admin", MANAGER)).rejects.toThrow(
			/Only an Admin may grant the Admin role/
		)

		const held = await db
			.select()
			.from(userRoles)
			.where(and(eq(userRoles.userId, MANAGER), eq(userRoles.roleId, adminRoleId)))
		expect(held).toHaveLength(0)
	})

	itDb("refuses a users.roles:manage holder granting Super Admin to someone else", async () => {
		await expect(makeService().assignRole(SUBJECT, "Super Admin", MANAGER)).rejects.toThrow(
			/Only an Admin may grant the Admin role/
		)
	})

	itDb("audits the refused self-escalation with actor, target and reason", async () => {
		await expect(makeService().assignRole(MANAGER, "Super Admin", MANAGER)).rejects.toThrow()

		const denials = await denialsFor(MANAGER)
		expect(denials).toHaveLength(1)
		expect(denials[0]!.action).toBe("role.assign")
		expect(denials[0]!.targetId).toBe(MANAGER)
		expect(denials[0]!.reason).toMatch(/self-escalation/)
		expect(denials[0]!.newValue).toEqual({ roleName: "Super Admin" })
	})

	itDb("distinguishes granting to another from granting to self in the reason", async () => {
		await expect(makeService().assignRole(SUBJECT, "Super Admin", MANAGER)).rejects.toThrow()

		const denials = await denialsFor(MANAGER)
		expect(denials[0]!.reason).toMatch(/not an Admin/)
	})

	itDb("allows an Admin to grant Admin, and audits the success", async () => {
		await makeService().assignRole(SUBJECT, "Super Admin", ADMIN_A)

		const held = await db
			.select()
			.from(userRoles)
			.where(and(eq(userRoles.userId, SUBJECT), eq(userRoles.roleId, adminRoleId)))
		expect(held).toHaveLength(1)

		const [entry] = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.targetId, SUBJECT), gt(auditLog.id, since)))
		expect(entry!.outcome).toBe("success")
		expect(entry!.actorId).toBe(ADMIN_A)
	})

	itDb("does not gate non-Admin roles behind Admin", async () => {
		// The tier check must apply only to the Super Admin role; a users.roles:manage
		// holder still administers ordinary roles.
		await expect(makeService().assignRole(SUBJECT, "Client", MANAGER)).resolves.toBeUndefined()
	})
})

describe("last Admin cannot be removed", () => {
	itDb("refuses the removal that would leave zero Admins, with 409 semantics", async () => {
		await setAdmins([ADMIN_A])

		await expect(makeService().removeRole(ADMIN_A, "Super Admin", ADMIN_A)).rejects.toThrow(
			/Cannot remove the last Admin/
		)
		expect(await adminCount()).toBe(1)
	})

	itDb("audits the refused last-Admin removal", async () => {
		await setAdmins([ADMIN_A])
		await expect(makeService().removeRole(ADMIN_A, "Super Admin", ADMIN_A)).rejects.toThrow()

		const denials = await denialsFor(ADMIN_A)
		expect(denials[0]!.action).toBe("role.remove")
		expect(denials[0]!.reason).toMatch(/zero Admin/)
	})

	itDb("allows removing an Admin while another remains", async () => {
		await setAdmins([ADMIN_A, ADMIN_B])

		await makeService().removeRole(ADMIN_B, "Super Admin", ADMIN_A)
		expect(await adminCount()).toBe(1)
	})

	itDb(
		"closes the check-then-write race: concurrent removals of the last two Admins",
		async () => {
			// Without the in-transaction locked count, both transactions read
			// "2 Admins remain" and both proceed, leaving nobody able to
			// administer the system.
			//
			// Repeated deliberately. A single round only loses the race about a
			// third of the time, so a one-shot version of this test would pass
			// two runs in three even with the lock removed — it would sit in the
			// suite looking like protection while catching nothing. Over ten
			// rounds an unlocked implementation is caught with ~98% probability.
			const service = makeService()

			for (let round = 1; round <= 10; round++) {
				await setAdmins([ADMIN_A, ADMIN_B])

				const results = await Promise.allSettled([
					service.removeRole(ADMIN_A, "Super Admin", ADMIN_A),
					service.removeRole(ADMIN_B, "Super Admin", ADMIN_B),
				])

				const succeeded = results.filter(r => r.status === "fulfilled").length

				expect(succeeded).toBeLessThanOrEqual(1)
				// Whatever happened, an Admin is still standing.
				expect(await adminCount()).toBeGreaterThanOrEqual(1)
			}
		},
		30_000
	)

	itDb("still allows removing a non-Admin role from the last Admin", async () => {
		await setAdmins([ADMIN_A])
		await makeService().assignRole(ADMIN_A, "Client", ADMIN_A)

		await expect(makeService().removeRole(ADMIN_A, "Client", ADMIN_A)).resolves.toBeUndefined()
		expect(await adminCount()).toBe(1)
	})

	itDb("treats removing Admin from someone who lacks it as a harmless no-op", async () => {
		await setAdmins([ADMIN_A])

		await expect(makeService().removeRole(SUBJECT, "Super Admin", ADMIN_A)).resolves.toBeUndefined()
		expect(await adminCount()).toBe(1)
	})
})
