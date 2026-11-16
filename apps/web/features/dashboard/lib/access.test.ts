import { describe, expect, it } from "vitest"

import type { PermissionName } from "@repo/contracts"

import { canAccess, permissionAvailability, type AccessProfile } from "./access"
import { getAccessibleNavItems, getDashboardRouteTitle, navItems } from "./nav-items"

const noAccess: AccessProfile = {
	roles: [],
	permissions: [],
}

describe("canAccess", () => {
	it("allows base items without requirements", () => {
		expect(canAccess(noAccess, {})).toBe(true)
	})

	it("allows the Super Admin role to satisfy permission requirements", () => {
		expect(
			canAccess(
				{ roles: ["Super Admin"], permissions: [] },
				{ requiredPermission: "users.roles:manage" }
			)
		).toBe(true)
	})

	it("allows exact permission matches", () => {
		expect(
			canAccess(
				{ roles: [], permissions: ["bookings.own:read"] },
				{ requiredPermission: "bookings.own:read" }
			)
		).toBe(true)
	})

	it("allows resource wildcard permission matches", () => {
		// The API now expands wildcards before sending them, but the helper still
		// honours one if it ever arrives.
		expect(
			canAccess(
				{ roles: [], permissions: ["bookings.own:*" as PermissionName] },
				{ requiredPermission: "bookings.own:cancel" }
			)
		).toBe(true)
	})

	it("allows any listed permission to match", () => {
		expect(
			canAccess(
				{ roles: [], permissions: ["users.accounts:manage"] },
				{ requiredPermission: ["users.accounts:read", "users.accounts:manage"] }
			)
		).toBe(true)
	})

	it("allows role requirements to match", () => {
		expect(canAccess({ roles: ["Cashier"], permissions: [] }, { requiredRole: "Cashier" })).toBe(
			true
		)
	})

	it("denies restricted items when no requirement matches", () => {
		expect(canAccess(noAccess, { requiredPermission: "users.accounts:read" })).toBe(false)
		expect(canAccess({ roles: ["Client"], permissions: [] }, { requiredRole: "Cashier" })).toBe(
			false
		)
	})
})

describe("permissionAvailability", () => {
	it("treats a failed lookup as unavailable, not as a missing permission", () => {
		expect(
			permissionAvailability(
				{ status: "error", roles: [], permissions: [] },
				{ requiredPermission: "bookings.own:create" }
			)
		).toBe("unavailable")
	})

	it("denies a loaded profile that does not hold the permission", () => {
		expect(
			permissionAvailability(
				{ status: "loaded", roles: [], permissions: [] },
				{ requiredPermission: "bookings.own:create" }
			)
		).toBe("denied")
	})

	it("allows a loaded profile that holds the permission", () => {
		expect(
			permissionAvailability(
				{ status: "loaded", roles: [], permissions: ["bookings.own:create"] },
				{ requiredPermission: "bookings.own:create" }
			)
		).toBe("allowed")
	})
})

describe("navItems", () => {
	it("defines base and RBAC-gated dashboard destinations", () => {
		expect(navItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: "Dashboard", href: "/dashboard" }),
				expect.objectContaining({
					label: "User Management",
					href: "/user-management",
					section: "Administration",
					requiredPermission: ["users.accounts:read", "users.accounts:manage"],
				}),
			])
		)
	})

	it("filters visible items from the shared access helper", () => {
		expect(getAccessibleNavItems(noAccess).map(item => item.label)).toEqual(["Dashboard"])

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["users.accounts:read"] }).map(
				item => item.label
			)
		).toContain("User Management")

		expect(
			getAccessibleNavItems({ roles: ["Super Admin"], permissions: [] }).map(item => item.label)
		).toEqual(["Dashboard", "User Management"])
	})

	it("resolves mobile header titles from dashboard routes", () => {
		expect(getDashboardRouteTitle("/dashboard")).toBe("Dashboard")
		expect(getDashboardRouteTitle("/user-management")).toBe("User Management")
		expect(getDashboardRouteTitle("/account")).toBe("Account")
	})
})
