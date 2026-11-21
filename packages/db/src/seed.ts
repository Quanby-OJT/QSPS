/* eslint-disable no-console -- CLI entrypoint: stdout/stderr is this script's only UI. */
import "dotenv/config"

import { randomBytes, scryptSync } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import {
	ADMIN_ROLE,
	PERMISSION_NAMES,
	ROLE_NAMES,
	ROLE_PERMISSIONS,
	type PermissionName,
	type RoleName,
} from "@repo/contracts"

import {
	accounts,
	permissions,
	rolePermissions,
	roles,
	schema,
	userRoles,
	users,
} from "./schema.js"
import {
	ALLOW_REMOTE_SEED_ENV,
	assertSeedAllowed,
	FORCE_PASSWORD_FLAG,
	hasForcePasswordFlag,
	resolveSeedPassword,
	SeedRefusedError,
	shouldWritePassword,
} from "./seed-guard.js"

/**
 * The turbo-template demo catalog. Databases seeded before FND-2 still hold
 * these rows; the seed removes them (and their grants and memberships) so a
 * re-seeded local database ends up with the QSPS catalog only.
 */
const LEGACY_TEMPLATE_ROLES = ["Admin", "Manager", "User"]
const LEGACY_TEMPLATE_PERMISSIONS = [
	"posts:read",
	"posts:create",
	"posts:edit",
	"posts:delete",
	"posts:*",
	"users:read",
	"users:read-directory",
	"users:manage",
]

async function hashPassword(password: string): Promise<string> {
	const saltHex = randomBytes(16).toString("hex")
	const key = scryptSync(password.normalize("NFKC"), saltHex, 64, {
		N: 16384,
		r: 16,
		p: 1,
		maxmem: 128 * 16384 * 16 * 2,
	})

	return `${saltHex}:${key.toString("hex")}`
}

async function seedDatabase() {
	const connectionString = process.env.DATABASE_URL

	if (!connectionString) {
		throw new Error("DATABASE_URL environment variable is not set")
	}

	// Refuse production (and any non-local database) BEFORE opening a pool
	// or writing a single row. Throws SeedRefusedError -> non-zero exit below.
	assertSeedAllowed({
		nodeEnv: process.env.NODE_ENV,
		databaseUrl: connectionString,
		allowRemote: process.env[ALLOW_REMOTE_SEED_ENV] === "true",
	})

	const forcePassword = hasForcePasswordFlag(process.argv.slice(2))
	const { password: seedPassword, generated: passwordWasGenerated } = resolveSeedPassword(
		process.env.SEED_ADMIN_PASSWORD
	)

	const pool = new Pool({ connectionString })
	const db = drizzle({ client: pool, schema })
	const now = new Date()
	const hashedSeedPassword = await hashPassword(seedPassword)

	const seedUsers: Array<typeof users.$inferInsert> = [
		{
			id: "seed-user-admin",
			name: "Admin User",
			email: "admin@qsps.local",
			emailVerified: true,
			// ADM-1: the seeded Super Admin is BOQ staff, so staff-only rules
			// (AUTH-2 mandatory MFA) apply to it.
			accountType: "staff",
			image: null,
			createdAt: now,
			updatedAt: now,
		},
		{
			id: "seed-user-alex",
			name: "Alex Johnson",
			email: "alex@qsps.local",
			emailVerified: true,
			image: null,
			createdAt: now,
			updatedAt: now,
		},
		{
			id: "seed-user-sam",
			name: "Sam Rivera",
			email: "sam@qsps.local",
			emailVerified: false,
			image: null,
			createdAt: now,
			updatedAt: now,
		},
	]

	const seededUserIds = seedUsers.map(user => user.id)
	const seedCredentialAccounts: Array<typeof accounts.$inferInsert> = seedUsers.map(user => ({
		providerId: "credential",
		accountId: user.id,
		userId: user.id,
		password: hashedSeedPassword,
		createdAt: now,
		updatedAt: now,
	}))

	const roleDescriptions: Record<RoleName, string> = {
		"Super Admin": "Full access via role-name short-circuit; approves major changes",
		"System Admin": "Users, settings, schedules, forms, and nationwide oversight",
		"Module Admin": "Runs one service area in assigned locations (limited by scope)",
		"Processing Officer": "Encodes, assesses, and issues documents (limited by scope)",
		"Cashier": "Collects onsite payments and issues receipts (limited by scope)",
		"Collecting Officer": "Closes daily collections and records deposits (limited by scope)",
		"Auditor": "Read-only access to transactions, reports, and audit logs",
		"Client": "Registered member of the public: books, pays, downloads documents",
	}

	const seedRoles: Array<typeof roles.$inferInsert> = ROLE_NAMES.map(name => ({
		name,
		description: roleDescriptions[name],
		createdAt: now,
		updatedAt: now,
	}))

	const permissionDescriptions: Record<PermissionName, string> = {
		"account.profile:manage": "Manage own profile",
		"users.accounts:read": "Read user accounts",
		"users.accounts:manage": "Create, edit, and disable user accounts",
		"users.roles:manage": "Assign and remove roles",
		"users.scopes:manage": "Assign service-category and location scopes",
		"audit.logs:read": "Read the audit log",
		"audit.logs:export": "Export the audit log",
		"settings.locations:manage": "Manage BOQ locations",
		"settings.services:manage": "Manage the service catalog and fees",
		"settings.policies:manage": "Manage booking and payment policies",
		"settings.announcements:manage": "Manage announcements and the flash screen",
		"settings.payment-channels:manage": "Manage payment channels and convenience fees",
		"settings.changes:approve": "Approve major configuration changes",
		"schedules.slots:manage": "Manage schedule slots and capacity",
		"forms.templates:manage": "Manage service questionnaires",
		"bookings.own:create": "Create own bookings",
		"bookings.own:read": "Read own bookings",
		"bookings.own:reschedule": "Reschedule own bookings",
		"bookings.own:cancel": "Cancel own bookings",
		"bookings.expedite:request": "Request an expedite booking",
		"bookings.expedite:approve": "Approve expedite bookings",
		"bookings.vip:create": "Create VIP bookings",
		"bookings.walk-in:create": "Create walk-in bookings",
		"bookings.all:read": "Read all bookings",
		"bookings.all:reschedule": "Reschedule any booking",
		"bookings.all:override": "Override any booking",
		"payments.own:create": "Pay own bookings",
		"payments.onsite:collect": "Collect onsite payments",
		"payments.transactions:read": "Read payment transactions",
		"payments.refunds:request": "Request refunds and forfeitures",
		"payments.refunds:approve": "Approve refunds and forfeitures",
		"payments.reconciliation:read": "Read payment reconciliation",
		"payments.deposits:verify": "Verify collecting officer deposits",
		"processing.queue:read": "Read the processing queue",
		"processing.assessments:perform": "Perform assessments",
		"processing.assessments:approve": "Approve assessments (head approval)",
		"processing.offline:use": "Use offline mode",
		"certificates.own:read": "Read own documents",
		"certificates.documents:issue": "Issue documents",
		"certificates.documents:print": "Print documents",
		"certificates.documents:revoke": "Revoke or reissue documents",
		"reports.dashboard:read": "Read the dashboard",
		"reports.sales:read": "Read sales and collections reports",
		"reports.operations:read": "Read operations reports",
		"reports.transactions:read": "Read the transaction monitor",
		"migration.imports:manage": "Run legacy imports",
		"migration.exports:create": "Create turnover exports",
	}

	const seedPermissions: Array<typeof permissions.$inferInsert> = PERMISSION_NAMES.map(name => ({
		name,
		description: permissionDescriptions[name],
		createdAt: now,
		updatedAt: now,
	}))

	// User id -> role name.
	const userRoleAssignments: Array<{ userId: string; roleName: RoleName }> = [
		{ userId: "seed-user-admin", roleName: ADMIN_ROLE },
		{ userId: "seed-user-alex", roleName: "Client" },
		{ userId: "seed-user-sam", roleName: "Client" },
	]

	let rolePermissionCount = 0
	let userRoleCount = 0
	let passwordsWritten = false

	try {
		await db.transaction(async tx => {
			for (const user of seedUsers) {
				await tx
					.insert(users)
					.values(user)
					.onConflictDoUpdate({
						target: users.id,
						set: {
							name: user.name,
							email: user.email,
							emailVerified: user.emailVerified,
							accountType: user.accountType ?? "client",
							image: user.image,
							updatedAt: now,
						},
					})
			}

			// Re-running the seeder must NOT rotate credentials that already
			// exist — only an explicit --force-password does that. New accounts still
			// get the resolved password on the INSERT path.
			const existingCredentialRows = await tx
				.select({ accountId: accounts.accountId })
				.from(accounts)
				.where(
					and(eq(accounts.providerId, "credential"), inArray(accounts.accountId, seededUserIds))
				)
			const existingCredentialIds = new Set(existingCredentialRows.map(row => row.accountId))

			for (const account of seedCredentialAccounts) {
				const writePassword = shouldWritePassword({
					accountExists: existingCredentialIds.has(account.accountId),
					forcePassword,
				})

				await tx
					.insert(accounts)
					.values(account)
					.onConflictDoUpdate({
						target: [accounts.providerId, accounts.accountId],
						set: writePassword
							? { userId: account.userId, password: account.password, updatedAt: now }
							: { userId: account.userId, updatedAt: now },
					})

				if (writePassword) {
					passwordsWritten = true
				}
			}

			// Remove the template demo catalog. Grants and memberships go first so
			// no row is left pointing at a deleted role or permission.
			const legacyRoleIds = (
				await tx
					.select({ id: roles.id })
					.from(roles)
					.where(inArray(roles.name, LEGACY_TEMPLATE_ROLES))
			).map(row => row.id)
			if (legacyRoleIds.length > 0) {
				await tx.delete(userRoles).where(inArray(userRoles.roleId, legacyRoleIds))
				await tx.delete(rolePermissions).where(inArray(rolePermissions.roleId, legacyRoleIds))
				await tx.delete(roles).where(inArray(roles.id, legacyRoleIds))
			}
			const legacyPermissionIds = (
				await tx
					.select({ id: permissions.id })
					.from(permissions)
					.where(inArray(permissions.name, LEGACY_TEMPLATE_PERMISSIONS))
			).map(row => row.id)
			if (legacyPermissionIds.length > 0) {
				await tx
					.delete(rolePermissions)
					.where(inArray(rolePermissions.permissionId, legacyPermissionIds))
				await tx.delete(permissions).where(inArray(permissions.id, legacyPermissionIds))
			}

			for (const role of seedRoles) {
				await tx
					.insert(roles)
					.values(role)
					.onConflictDoUpdate({
						target: roles.name,
						set: { description: role.description, updatedAt: now },
					})
			}

			for (const permission of seedPermissions) {
				await tx
					.insert(permissions)
					.values(permission)
					.onConflictDoUpdate({
						target: permissions.name,
						set: { description: permission.description, updatedAt: now },
					})
			}

			const roleRows = await tx.select().from(roles)
			const permissionRows = await tx.select().from(permissions)
			const roleIdByName = new Map<string, number>(roleRows.map(r => [r.name, r.id]))
			const permissionIdByName = new Map<string, number>(permissionRows.map(p => [p.name, p.id]))

			const seedRolePermissions: Array<typeof rolePermissions.$inferInsert> = []
			for (const [roleName, permNames] of Object.entries(ROLE_PERMISSIONS)) {
				const roleId = roleIdByName.get(roleName)
				if (roleId === undefined) continue
				for (const permName of permNames) {
					const permissionId = permissionIdByName.get(permName)
					if (permissionId === undefined) continue
					seedRolePermissions.push({ roleId, permissionId })
				}
			}

			for (const row of seedRolePermissions) {
				await tx.insert(rolePermissions).values(row).onConflictDoNothing()
			}
			rolePermissionCount = seedRolePermissions.length

			const seedUserRoles: Array<typeof userRoles.$inferInsert> = []
			for (const assignment of userRoleAssignments) {
				const roleId = roleIdByName.get(assignment.roleName)
				if (roleId === undefined) continue
				seedUserRoles.push({ userId: assignment.userId, roleId })
			}

			for (const row of seedUserRoles) {
				await tx.insert(userRoles).values(row).onConflictDoNothing()
			}
			userRoleCount = seedUserRoles.length
		})

		// The password is printed ONLY when this run generated it AND actually
		// wrote it. An operator-supplied SEED_ADMIN_PASSWORD is never echoed, and
		// a preserved existing password is not ours to disclose.
		const credentialNote = !passwordsWritten
			? `Existing seed credentials left untouched (re-run with ${FORCE_PASSWORD_FLAG} to reset them).`
			: passwordWasGenerated
				? `Generated seed password (shown once, not stored anywhere): ${seedPassword}`
				: "Seed password taken from SEED_ADMIN_PASSWORD (not printed)."

		console.log(
			`Seeded ${seedUsers.length} users and ${seedCredentialAccounts.length} credential accounts.\n` +
				`RBAC: ${seedRoles.length} roles, ${seedPermissions.length} permissions, ${rolePermissionCount} role-permission mappings, ${userRoleCount} user-role assignments.\n${
					credentialNote
				}`
		)
	} finally {
		await pool.end()
	}
}

void seedDatabase().catch(error => {
	// A refusal is a deliberate outcome, not a crash: print the actionable
	// message without a stack trace, but still exit non-zero so CI/scripts stop.
	if (error instanceof SeedRefusedError) {
		console.error(error.message)
	} else {
		console.error("Database seeding failed.")
		console.error(error)
	}
	process.exitCode = 1
})
