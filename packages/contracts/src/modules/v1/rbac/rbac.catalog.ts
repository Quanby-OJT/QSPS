import { z } from "zod"

/**
 * RBAC catalog
 *
 * Shared role and permission constants, Zod enums, and inferred types.
 * Consumed by the backend RBAC guard, seed scripts, and the frontend.
 * The source of truth is docs/DOMAIN-MODEL.md section 2.
 */

// ---------------------------------------------------------------------------
// Role names
// ---------------------------------------------------------------------------

/**
 * Canonical role names: the TOR Annex A roles plus the Collecting Officer
 * (RCO) role added in DOMAIN-MODEL section 7. Order is significant for
 * display only. Roles are data: they are seeded once and stay editable.
 */
export const ROLE_NAMES = [
	"Super Admin",
	"System Admin",
	"Module Admin",
	"Processing Officer",
	"Cashier",
	"Collecting Officer",
	"Auditor",
	"Client",
] as const

/** Zod enum validating a role name. */
export const RoleNameSchema = z.enum(ROLE_NAMES)

/**
 * The super-role. The RBAC guard short-circuits and grants access when a
 * principal holds this role, regardless of the required permission.
 */
export const ADMIN_ROLE = "Super Admin" as const

/** A valid role name. */
export type RoleName = z.infer<typeof RoleNameSchema>

/**
 * Roles that act nationwide (ADM-2). DOMAIN-MODEL glossary: an empty Scope
 * means nationwide and is reserved for these roles. Every other staff role
 * sees only the Service Categories and Locations in its `user_scopes` rows.
 */
export const NATIONWIDE_ROLES: readonly RoleName[] = ["Super Admin", "System Admin", "Auditor"]

/**
 * Roles a Module Admin may give a staff account (ADM-2): only those below
 * Module Admin. Super Admin and System Admin may give any role.
 */
export const MODULE_ADMIN_ASSIGNABLE_ROLES: readonly RoleName[] = [
	"Processing Officer",
	"Cashier",
	"Collecting Officer",
]

// ---------------------------------------------------------------------------
// Permission catalog
// ---------------------------------------------------------------------------

/**
 * Permission naming convention: `module.submodule:action`.
 *
 * - `module.submodule` is the resource being protected (e.g. `bookings.own`).
 * - `action` is the verb performed on it (e.g. `create`).
 *
 * Wildcard semantics: `resource:*` grants all actions on that resource. The
 * guard matches on the text before the colon, so holding `bookings.own:*`
 * satisfies a required `bookings.own:create` or `bookings.own:cancel`.
 * The seeded roles store explicit keys only (see {@link ROLE_PERMISSIONS});
 * the wildcard rule stays in the guard for roles that hold one.
 *
 * Every key a route may require lives here. A route that requires a key not
 * in this list is denied for everyone except the super-role (fail closed).
 */
export const PERMISSION_NAMES = [
	// account
	"account.profile:manage",
	// users
	"users.accounts:read",
	"users.accounts:manage",
	"users.roles:manage",
	"users.scopes:manage",
	// audit
	"audit.logs:read",
	"audit.logs:export",
	// settings
	"settings.locations:manage",
	"settings.services:manage",
	"settings.policies:manage",
	"settings.announcements:manage",
	"settings.payment-channels:manage",
	"settings.changes:approve",
	// schedules
	"schedules.slots:manage",
	// forms
	"forms.templates:manage",
	// bookings
	"bookings.own:create",
	"bookings.own:read",
	"bookings.own:reschedule",
	"bookings.own:cancel",
	"bookings.expedite:request",
	"bookings.expedite:approve",
	"bookings.vip:create",
	"bookings.walk-in:create",
	"bookings.all:read",
	"bookings.all:reschedule",
	"bookings.all:override",
	// payments
	"payments.own:create",
	"payments.onsite:collect",
	"payments.transactions:read",
	"payments.refunds:request",
	"payments.refunds:approve",
	"payments.reconciliation:read",
	"payments.deposits:verify",
	// processing
	"processing.queue:read",
	"processing.assessments:perform",
	"processing.assessments:approve",
	"processing.offline:use",
	// certificates
	"certificates.own:read",
	"certificates.documents:issue",
	"certificates.documents:print",
	"certificates.documents:revoke",
	// reports
	"reports.dashboard:read",
	"reports.sales:read",
	"reports.operations:read",
	"reports.transactions:read",
	// migration
	"migration.imports:manage",
	"migration.exports:create",
] as const

/** Zod enum validating a permission name. */
export const PermissionNameSchema = z.enum(PERMISSION_NAMES)

/** A valid permission name. */
export type PermissionName = z.infer<typeof PermissionNameSchema>

// ---------------------------------------------------------------------------
// Seeded role grants
// ---------------------------------------------------------------------------

/**
 * Every catalog key in one module (`keysIn("reports")`) or one resource
 * (`keysIn("bookings.own")`).
 *
 * DOMAIN-MODEL writes some grants as `reports.*` or `bookings.own:*`. They are
 * expanded into explicit keys here so the database, the roles screen, and
 * `/me` only ever see catalog keys.
 */
function keysIn(prefix: string): PermissionName[] {
	const separator = prefix.includes(".") ? ":" : "."
	return PERMISSION_NAMES.filter(key => key.startsWith(`${prefix}${separator}`))
}

/**
 * Grants for each seeded role, from DOMAIN-MODEL section 2 ("Seeded roles")
 * and section 7. Super Admin has no rows: it is granted everything by the
 * {@link ADMIN_ROLE} short-circuit. Scope limits (Service Category and
 * Location) are enforced separately in ADM-2.
 */
export const ROLE_PERMISSIONS: Record<RoleName, readonly PermissionName[]> = {
	"Super Admin": [],
	"System Admin": [
		...keysIn("users"),
		...keysIn("settings").filter(key => key !== "settings.changes:approve"),
		...keysIn("schedules"),
		...keysIn("forms"),
		"audit.logs:read",
		...keysIn("bookings.all"),
		...keysIn("reports"),
		"payments.transactions:read",
	],
	"Module Admin": [
		"users.accounts:read",
		"users.accounts:manage",
		"schedules.slots:manage",
		"forms.templates:manage",
		"settings.locations:manage",
		"settings.services:manage",
		"payments.deposits:verify",
		...keysIn("bookings.all"),
		"bookings.expedite:approve",
		"bookings.vip:create",
		...keysIn("processing"),
		...keysIn("certificates.documents"),
		"reports.dashboard:read",
		"reports.operations:read",
	],
	"Processing Officer": [
		"processing.queue:read",
		"processing.assessments:perform",
		"processing.offline:use",
		"bookings.walk-in:create",
		"bookings.all:read",
		"certificates.documents:issue",
		"certificates.documents:print",
	],
	"Cashier": [
		"payments.onsite:collect",
		"payments.transactions:read",
		"payments.refunds:request",
		"bookings.all:read",
		"reports.dashboard:read",
	],
	"Collecting Officer": [
		"payments.onsite:collect",
		"payments.transactions:read",
		"payments.refunds:request",
		"bookings.all:read",
		"reports.dashboard:read",
	],
	"Auditor": [
		"audit.logs:read",
		"audit.logs:export",
		"payments.transactions:read",
		"payments.reconciliation:read",
		...keysIn("reports"),
		"bookings.all:read",
	],
	"Client": [
		"account.profile:manage",
		...keysIn("bookings.own"),
		"bookings.expedite:request",
		"payments.own:create",
		"certificates.own:read",
	],
}
