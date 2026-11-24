import { describe, expect, it } from "vitest"

import { ADMIN_ROLE, PERMISSION_NAMES, ROLE_NAMES, ROLE_PERMISSIONS } from "./rbac.catalog"

describe("QSPS RBAC catalog", () => {
	it("has the 47 keys from DOMAIN-MODEL section 2, each in module.submodule:action form", () => {
		expect(PERMISSION_NAMES).toHaveLength(47)
		expect(new Set(PERMISSION_NAMES).size).toBe(PERMISSION_NAMES.length)
		for (const key of PERMISSION_NAMES) {
			expect(key).toMatch(/^[a-z]+\.[a-z-]+:[a-z-]+$/)
		}
	})

	it("seeds every role, and Super Admin is the short-circuit role with no rows", () => {
		expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLE_NAMES].sort())
		expect(ADMIN_ROLE).toBe("Super Admin")
		expect(ROLE_PERMISSIONS[ADMIN_ROLE]).toEqual([])
	})

	it("grants only catalog keys, without duplicates", () => {
		for (const grants of Object.values(ROLE_PERMISSIONS)) {
			expect(new Set(grants).size).toBe(grants.length)
			for (const grant of grants) {
				expect(PERMISSION_NAMES).toContain(grant)
			}
		}
	})

	it("expands DOMAIN-MODEL wildcards into explicit keys", () => {
		expect(ROLE_PERMISSIONS.Client).toEqual(
			expect.arrayContaining([
				"bookings.own:create",
				"bookings.own:read",
				"bookings.own:reschedule",
				"bookings.own:cancel",
			])
		)
		expect(ROLE_PERMISSIONS.Auditor).toEqual(
			expect.arrayContaining([
				"reports.dashboard:read",
				"reports.sales:read",
				"reports.operations:read",
				"reports.transactions:read",
			])
		)
		expect(ROLE_PERMISSIONS["Module Admin"]).toContain("certificates.documents:revoke")
	})

	it("gives the cashier roles nothing that edits client data or schedules (PAY-4, Annex A)", () => {
		for (const role of ["Cashier", "Collecting Officer"] as const) {
			const grants = ROLE_PERMISSIONS[role]
			expect(grants).toContain("payments.onsite:collect")
			for (const grant of grants) {
				expect(grant).not.toMatch(/^(users|schedules|settings|account|forms)\./)
				expect(grant).not.toMatch(/^bookings\..*:(create|reschedule|cancel|manage)$/)
			}
		}
	})

	it("keeps settings.changes:approve with Super Admin only", () => {
		for (const [role, grants] of Object.entries(ROLE_PERMISSIONS)) {
			if (role === ADMIN_ROLE) continue
			expect(grants).not.toContain("settings.changes:approve")
		}
	})

	it("gives the email directory (users.accounts:manage) only to the account-managing roles", () => {
		// RbacController.listUsers returns email addresses only to holders of
		// users.accounts:manage; users.accounts:read alone gets names and roles.
		const directoryRoles = Object.entries(ROLE_PERMISSIONS)
			.filter(([, grants]) => grants.includes("users.accounts:manage"))
			.map(([role]) => role)

		expect(directoryRoles.sort()).toEqual(["Module Admin", "System Admin"])
	})
})
