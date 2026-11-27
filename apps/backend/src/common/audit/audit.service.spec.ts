/**
 * The audit trail's two load-bearing guarantees.
 *
 * These run against a real Postgres (the same instance the app uses), because
 * the claim under test is transactional: a privileged mutation and its audit
 * entry either both commit or neither does. A mocked `db` would let a broken
 * implementation pass by construction, since the rollback is the database's
 * behaviour, not ours.
 *
 * Skips itself when no database is reachable, and when Postgres is up but
 * `pnpm db:push` has not created the relations this file uses. A table that
 * exists still runs. Cases that read the seeded Admin role also skip when that
 * row is absent; the message names `pnpm db:seed`. The other cases insert their
 * own role and still run. CI provides Postgres (the workflow wires the compose
 * service).
 */

import { and, asc, desc, eq, gt } from "drizzle-orm"

import { archiveBatches, auditLog, roles, userRoles, users } from "@repo/db/schema"

import { verifyChain } from "@/common/audit/audit-chain"
import { AUDIT_DOMAIN_RBAC, AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { ExportService } from "@/common/export/export.service"
import { RbacCacheService } from "@/common/rbac/rbac-cache.service"
import { RbacService } from "@/common/rbac/rbac.service"
import { runWithRequestContext } from "@/common/request-context/request-context"
import { RbacAdminService } from "@/modules/v1/rbac/rbac-admin.service"
import { bindDbBackedTests, bindSeededCases } from "@/testing/db-ready"

// The database, the schema and the transaction are all real — that is the
// point. Only `@repo/contracts` is stubbed, matching the convention in the
// other RBAC specs: it pulls an ESM chain (`@orpc/*`) this jest config does
// not transform, and nothing here depends on its runtime values beyond the two
// constants RbacService reads.
jest.mock("@repo/contracts", () => ({
	ADMIN_ROLE: "Super Admin",
	PERMISSION_NAMES: ["users.accounts:read", "users.roles:manage"],
}))

// `RbacAdminService` imports ORPCError from `@orpc/server`, another ESM
// package this jest config does not transform. The stub keeps the one
// behaviour the denial tests rely on — that a refusal throws with its reason.
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

// audit_log is append-only (FND-3): a database trigger refuses DELETE, so this
// suite can no longer wipe its rows between runs. Each run uses its own ids,
// and each test reads only rows written after it started (`since`). The two
// users stay behind in the local database: a user with audit entries cannot
// be deleted, by design.
const RUN = Date.now().toString(36)
const TEST_USER = `az4-test-subject-${RUN}`
const TEST_ACTOR = `az4-test-actor-${RUN}`
const TEST_ROLE = `AZ4TestRole-${RUN}`

const dbTests = bindDbBackedTests({
	label: "az-4",
	relations: ["users", "roles", "user_roles", "audit_log"],
	database: db,
})
const itDb = dbTests.itDb
const adminSeed = bindSeededCases({
	label: "az-4",
	rows: ["Super Admin"],
	itDb,
})

/** Removes what can be removed. Audit rows, and the users they name, stay. */
async function cleanup() {
	await db.delete(userRoles).where(eq(userRoles.userId, TEST_USER))
	await db.delete(userRoles).where(eq(userRoles.userId, TEST_ACTOR))
	await db.delete(roles).where(eq(roles.name, TEST_ROLE))
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

beforeAll(async () => {
	await dbTests.probe()
	if (!dbTests.ready) return

	await cleanup()

	const now = new Date()
	await db.insert(users).values([
		{
			id: TEST_USER,
			name: "AZ4 Subject",
			email: `az4-subject-${RUN}@test.local`,
			createdAt: now,
			updatedAt: now,
		},
		{
			id: TEST_ACTOR,
			name: "AZ4 Actor",
			email: `az4-actor-${RUN}@test.local`,
			createdAt: now,
			updatedAt: now,
		},
	])
	await db.insert(roles).values({ name: TEST_ROLE, description: "fixture" })
})

beforeEach(async () => {
	if (dbTests.ready) since = await latestAuditId()
})

afterAll(async () => {
	if (dbTests.ready) await cleanup()
	// Drizzle keeps a pool open once select 1 has succeeded, including when the
	// schema is missing and the cases below only warn. Without end(), jest hangs.
	if (dbTests.connected) await db.$client.end()
})

function makeRbacService() {
	return new RbacService(new RbacCacheService(null), new AuditService())
}

function makeAdminService() {
	const cache = new RbacCacheService(null)
	const audit = new AuditService()
	return new RbacAdminService(new RbacService(cache, audit), cache, audit, new ExportService())
}

/** Entries about `targetId` written during the current test, oldest first. */
async function entriesFor(targetId: string) {
	return db
		.select()
		.from(auditLog)
		.where(and(eq(auditLog.targetId, targetId), gt(auditLog.id, since)))
		.orderBy(asc(auditLog.id))
}

/** Entries by `actorId` written during the current test, oldest first. */
async function entriesBy(actorId: string) {
	return db
		.select()
		.from(auditLog)
		.where(and(eq(auditLog.actorId, actorId), gt(auditLog.id, since)))
		.orderBy(asc(auditLog.id))
}

describe("audit trail is written in the same transaction as the mutation", () => {
	beforeEach(async () => {
		if (!dbTests.ready) return
		await db.delete(userRoles).where(eq(userRoles.userId, TEST_USER))
	})

	itDb("records a grant with actor, target and old→new state", async () => {
		await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		const entries = await entriesFor(TEST_USER)
		expect(entries).toHaveLength(1)

		const entry = entries[0]!
		expect(entry.domain).toBe(AUDIT_DOMAIN_RBAC)
		expect(entry.action).toBe("role.assign")
		expect(entry.outcome).toBe("success")
		expect(entry.actorId).toBe(TEST_ACTOR)
		expect(entry.targetType).toBe("user")
		expect(entry.oldValue).toEqual({ roleHeld: false })
		expect(entry.newValue).toEqual({ roleHeld: true, roleName: TEST_ROLE })
	})

	itDb("records a removal with old→new state", async () => {
		const service = makeRbacService()
		await service.assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		await service.removeRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		const actions = (await entriesFor(TEST_USER)).map(e => e.action)
		expect(actions).toEqual(["role.assign", "role.remove"])
	})

	itDb("rolls the grant back when the audit insert fails", async () => {
		// A privileged change must not be able to
		// commit unrecorded. Break only the audit write and the grant must die
		// with it.
		const audit = new AuditService()
		jest.spyOn(audit, "record").mockRejectedValue(new Error("audit sink unavailable"))

		const service = new RbacService(new RbacCacheService(null), audit)

		await expect(service.assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)).rejects.toThrow(
			/audit sink unavailable/
		)

		const [role] = await db.select().from(roles).where(eq(roles.name, TEST_ROLE))
		const held = await db
			.select()
			.from(userRoles)
			.where(and(eq(userRoles.userId, TEST_USER), eq(userRoles.roleId, role!.id)))

		expect(held).toHaveLength(0)
		expect(await entriesFor(TEST_USER)).toHaveLength(0)
	})

	itDb("rolls the removal back when the audit insert fails", async () => {
		await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		const audit = new AuditService()
		jest.spyOn(audit, "record").mockRejectedValue(new Error("audit sink unavailable"))

		await expect(
			new RbacService(new RbacCacheService(null), audit).removeRole(
				TEST_USER,
				TEST_ROLE,
				TEST_ACTOR
			)
		).rejects.toThrow(/audit sink unavailable/)

		const [role] = await db.select().from(roles).where(eq(roles.name, TEST_ROLE))
		const held = await db
			.select()
			.from(userRoles)
			.where(and(eq(userRoles.userId, TEST_USER), eq(userRoles.roleId, role!.id)))

		// Still held — the removal was undone with its audit entry.
		expect(held).toHaveLength(1)
	})
})

describe("refused privileged attempts are recorded", () => {
	// "a denial is evidence". Who *tried* to escalate and was stopped is
	// the question an audit trail most often has to answer, so a rejection must
	// leave a row behind rather than only an error response.
	let adminRoleId: number

	beforeAll(async () => {
		if (!dbTests.ready) return
		const [admin] = await db.select().from(roles).where(eq(roles.name, "Super Admin"))
		// Admin is inserted by `pnpm db:seed`, not by `pnpm db:push`.
		if (!admin) {
			adminSeed.markMissing()
			return
		}
		adminRoleId = admin.id
	})

	const itAdmin = adminSeed.itDb

	itAdmin("records the refusal to rename the Admin role", async () => {
		await expect(
			makeAdminService().updateRole({ id: adminRoleId, name: "NotAdmin" }, TEST_ACTOR)
		).rejects.toThrow(/cannot be renamed/)

		const [entry] = await entriesBy(TEST_ACTOR)

		expect(entry).toBeDefined()
		expect(entry!.domain).toBe(AUDIT_DOMAIN_RBAC)
		expect(entry!.action).toBe("role.update")
		expect(entry!.outcome).toBe("denied")
		expect(entry!.actorId).toBe(TEST_ACTOR)
		expect(entry!.targetType).toBe("role")
		expect(entry!.targetId).toBe(String(adminRoleId))
		expect(entry!.reason).toMatch(/cannot be renamed/)
		// The attempted change is preserved, not just the fact of refusal.
		expect(entry!.newValue).toEqual({ name: "NotAdmin" })
	})

	itAdmin("records the refusal to delete the Admin role", async () => {
		await expect(makeAdminService().deleteRole(adminRoleId, TEST_ACTOR)).rejects.toThrow(
			/cannot be deleted/
		)

		const [entry] = await entriesBy(TEST_ACTOR)

		expect(entry!.action).toBe("role.delete")
		expect(entry!.outcome).toBe("denied")
		expect(entry!.reason).toMatch(/cannot be deleted/)
	})

	itAdmin("leaves the Admin role untouched after a refused attempt", async () => {
		await expect(makeAdminService().deleteRole(adminRoleId, TEST_ACTOR)).rejects.toThrow()

		const [admin] = await db.select().from(roles).where(eq(roles.id, adminRoleId))
		expect(admin?.name).toBe("Super Admin")
	})

	itAdmin("surfaces denials through the read API alongside successes", async () => {
		await expect(makeAdminService().deleteRole(adminRoleId, TEST_ACTOR)).rejects.toThrow()

		const { entries } = await new AuditService().list({ limit: 50 })
		const denial = entries.find(e => e.actorId === TEST_ACTOR && e.outcome === "denied")

		expect(denial).toBeDefined()
		expect(denial!.action).toBe("role.delete")
	})
})

describe("audit log reads", () => {
	beforeEach(async () => {
		if (!dbTests.ready) return
		await db.delete(userRoles).where(eq(userRoles.userId, TEST_USER))
	})

	itDb("returns entries newest first", async () => {
		const service = makeRbacService()
		await service.assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		await service.removeRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		const { entries } = await new AuditService().list({ limit: 50 })
		const mine = entries.filter(e => e.targetId === TEST_USER)

		expect(mine[0]?.action).toBe("role.remove")
		expect(mine[1]?.action).toBe("role.assign")
		// Ordered by id, so entries sharing a timestamp still sort deterministically.
		expect(mine[0]!.id).toBeGreaterThan(mine[1]!.id)
	})

	itDb("resolves the actor's email for display", async () => {
		await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		const { entries } = await new AuditService().list({ limit: 50 })
		const mine = entries.find(e => e.targetId === TEST_USER)

		expect(mine?.actorEmail).toBe(`az4-actor-${RUN}@test.local`)
	})

	itDb("pages with a cursor and reports the next one", async () => {
		const service = makeRbacService()
		await service.assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		await service.removeRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		const first = await new AuditService().list({ limit: 1 })
		expect(first.entries).toHaveLength(1)
		expect(first.nextCursor).toBe(first.entries[0]!.id)

		const second = await new AuditService().list({ limit: 1, before: first.nextCursor! })
		expect(second.entries[0]!.id).toBeLessThan(first.entries[0]!.id)
	})

	itDb("exposes no update or delete method", () => {
		// The append-only rule is enforced by there being no other way in.
		// ADM-3 added `get`, which only reads one entry.
		const surface = Object.getOwnPropertyNames(AuditService.prototype)
		expect(surface.sort()).toEqual(["constructor", "get", "list", "record"])
	})
})

describe("audit log filters (ADM-3)", () => {
	beforeEach(async () => {
		if (!dbTests.ready) return
		await db.delete(userRoles).where(eq(userRoles.userId, TEST_USER))
	})

	/** A Manila business date, YYYY-MM-DD, `offsetDays` from today. */
	function manilaDate(offsetDays = 0): string {
		const at = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000)
		return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(at)
	}

	itDb("filters by action prefix and target", async () => {
		const service = makeRbacService()
		await service.assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		await service.removeRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		// Earlier tests in this run wrote rows about TEST_USER too; count only this test's.
		const fresh = (entries: { id: number; action: string }[]) =>
			entries.filter(e => e.id > since).map(e => e.action)

		const audit = new AuditService()
		const removes = await audit.list({
			limit: 50,
			action: "role.remove",
			targetType: "user",
			targetId: TEST_USER,
		})
		expect(fresh(removes.entries)).toEqual(["role.remove"])
		expect(removes.entries.every(e => e.action === "role.remove")).toBe(true)

		const both = await audit.list({ limit: 50, action: "role.", targetId: TEST_USER })
		expect(fresh(both.entries)).toEqual(["role.remove", "role.assign"])
	})

	itDb("filters by actor email, domain and outcome", async () => {
		await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		const audit = new AuditService()
		const mine = await audit.list({
			limit: 50,
			actor: `az4-actor-${RUN}`,
			domain: AUDIT_DOMAIN_RBAC,
			outcome: "success",
			targetId: TEST_USER,
		})
		expect(mine.entries.length).toBeGreaterThan(0)
		expect(mine.entries.every(e => e.actorId === TEST_ACTOR)).toBe(true)

		const denied = await audit.list({ limit: 50, outcome: "denied", targetId: TEST_USER })
		expect(denied.entries).toHaveLength(0)
	})

	itDb("filters by the role the actor held at the time", async () => {
		const [role] = await db.select().from(roles).where(eq(roles.name, TEST_ROLE))
		await db.insert(userRoles).values({ userId: TEST_ACTOR, roleId: role!.id })
		try {
			await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		} finally {
			await db.delete(userRoles).where(eq(userRoles.userId, TEST_ACTOR))
		}

		const { entries } = await new AuditService().list({
			limit: 50,
			role: TEST_ROLE,
			targetId: TEST_USER,
		})
		expect(entries.map(e => e.action)).toContain("role.assign")
	})

	itDb("filters by Manila date range, both days included", async () => {
		await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		const audit = new AuditService()

		const today = await audit.list({
			limit: 50,
			from: manilaDate(),
			to: manilaDate(),
			targetId: TEST_USER,
		})
		expect(today.entries.length).toBeGreaterThan(0)

		const beforeToday = await audit.list({ limit: 50, to: manilaDate(-1), targetId: TEST_USER })
		expect(beforeToday.entries).toHaveLength(0)

		const afterToday = await audit.list({ limit: 50, from: manilaDate(1), targetId: TEST_USER })
		expect(afterToday.entries).toHaveLength(0)
	})

	itDb('finds System actions with actor "system"', async () => {
		const target = `adm3-system-${RUN}`
		await new AuditService().record({
			domain: "booking.hold-expiry",
			action: "booking.cancel",
			actorId: null,
			targetType: "booking",
			targetId: target,
		})

		const { entries } = await new AuditService().list({
			limit: 50,
			actor: "system",
			targetId: target,
		})
		expect(entries).toHaveLength(1)
		expect(entries[0]!.actorId).toBeNull()
	})

	itDb("treats % and _ in the actor filter as plain text", async () => {
		await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		const { entries } = await new AuditService().list({
			limit: 50,
			actor: "%",
			targetId: TEST_USER,
		})
		expect(entries).toHaveLength(0)
	})

	itDb("opens one entry with IP address, device and hash", async () => {
		await runWithRequestContext({ ipAddress: "198.51.100.4", userAgent: "adm3-test-agent" }, () =>
			makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		)
		const [stored] = await entriesFor(TEST_USER)

		const entry = await new AuditService().get(stored!.id)
		expect(entry).not.toBeNull()
		expect(entry!.ipAddress).toBe("198.51.100.4")
		expect(entry!.userAgent).toBe("adm3-test-agent")
		expect(entry!.actorEmail).toBe(`az4-actor-${RUN}@test.local`)
		expect(entry!.newValue).toEqual({ roleHeld: true, roleName: TEST_ROLE })
		expect(entry!.entryHash).toBe(stored!.entryHash)
	})

	itDb("answers null for an entry that does not exist", async () => {
		expect(await new AuditService().get(2_147_483_647)).toBeNull()
	})
})

describe("tamper-resistant trail (FND-3)", () => {
	beforeEach(async () => {
		if (!dbTests.ready) return
		await db.delete(userRoles).where(eq(userRoles.userId, TEST_USER))
		await db.delete(userRoles).where(eq(userRoles.userId, TEST_ACTOR))
	})

	itDb("stores the actor's roles, IP address and user agent from the request", async () => {
		const [role] = await db.select().from(roles).where(eq(roles.name, TEST_ROLE))
		await db.insert(userRoles).values({ userId: TEST_ACTOR, roleId: role!.id })

		await runWithRequestContext({ ipAddress: "203.0.113.7", userAgent: "fnd3-test-agent" }, () =>
			makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		)

		const [entry] = await entriesFor(TEST_USER)
		expect(entry!.actorRole).toBe(TEST_ROLE)
		expect(entry!.ipAddress).toBe("203.0.113.7")
		expect(entry!.userAgent).toBe("fnd3-test-agent")
		expect(entry!.entryHash).toMatch(/^[0-9a-f]{64}$/)
	})

	itDb("records a System action with no actor, role, IP or user agent", async () => {
		const target = `fnd3-hold-${RUN}`
		await new AuditService().record({
			domain: "booking.hold-expiry",
			action: "booking.cancel",
			actorId: null,
			targetType: "booking",
			targetId: target,
		})

		const [entry] = await entriesFor(target)
		expect(entry!.domain).toBe("booking.hold-expiry")
		expect(entry!.actorId).toBeNull()
		expect(entry!.actorRole).toBeNull()
		expect(entry!.ipAddress).toBeNull()
		expect(entry!.userAgent).toBeNull()
	})

	itDb("chains each entry to the one before it", async () => {
		const service = makeRbacService()
		await service.assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		await service.removeRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		// Every entry since this test started, from any writer, in id order.
		const rows = await db
			.select()
			.from(auditLog)
			.where(gt(auditLog.id, since))
			.orderBy(asc(auditLog.id))
		for (let i = 1; i < rows.length; i++) {
			expect(rows[i]!.prevHash).toBe(rows[i - 1]!.entryHash)
		}
	})

	itDb("verifies the whole stored chain", async () => {
		await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)

		// Older rows may sit in archive files (OPS-4): start after the newest archived batch.
		const [batch] = await db
			.select()
			.from(archiveBatches)
			.where(eq(archiveBatches.dataClass, "audit_log"))
			.orderBy(desc(archiveBatches.lastId))
			.limit(1)
		const rows = await db
			.select()
			.from(auditLog)
			.where(gt(auditLog.id, batch?.lastId ?? 0))
			.orderBy(asc(auditLog.id))
		const check = verifyChain(rows, batch?.chainTailHash ?? null)

		expect(check).toMatchObject({ ok: true })
		expect(check.checked).toBeGreaterThan(0)
	})

	itDb("rejects UPDATE and DELETE on audit_log at the database", async () => {
		await makeRbacService().assignRole(TEST_USER, TEST_ROLE, TEST_ACTOR)
		const [entry] = await entriesFor(TEST_USER)

		await expect(
			db.update(auditLog).set({ reason: "edited" }).where(eq(auditLog.id, entry!.id))
		).rejects.toThrow()
		await expect(db.delete(auditLog).where(eq(auditLog.id, entry!.id))).rejects.toThrow()

		const [after] = await db.select().from(auditLog).where(eq(auditLog.id, entry!.id))
		expect(after!.reason).toBe(entry!.reason)
	})
})
