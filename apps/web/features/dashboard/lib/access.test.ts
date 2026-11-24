import { describe, expect, it } from "vitest"

import type { PermissionName } from "@repo/contracts"

import { canAccess, permissionAvailability, type AccessProfile } from "./access"
import {
	getAccessibleNavItems,
	getActiveNavHref,
	getDashboardRouteTitle,
	navItems,
} from "./nav-items"

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
					label: "Book an appointment",
					href: "/book",
					requiredPermission: "bookings.own:create",
				}),
				expect.objectContaining({
					label: "Processing",
					href: "/processing",
					requiredPermission: "processing.queue:read",
				}),
				expect.objectContaining({
					label: "Walk-in",
					href: "/processing/walk-in",
					requiredPermission: "bookings.walk-in:create",
				}),
				expect.objectContaining({
					label: "Approvals",
					href: "/processing/approvals",
					requiredPermission: "processing.assessments:approve",
				}),
				expect.objectContaining({
					label: "Cashier",
					href: "/cashier",
					requiredPermission: "payments.onsite:collect",
				}),
				expect.objectContaining({
					label: "Payment exceptions",
					href: "/payment-exceptions",
					requiredPermission: "payments.transactions:read",
				}),
				expect.objectContaining({
					label: "User Management",
					href: "/user-management",
					section: "Administration",
					requiredPermission: ["users.accounts:read", "users.accounts:manage"],
				}),
				expect.objectContaining({
					label: "Locations",
					href: "/locations",
					section: "Administration",
					requiredPermission: "settings.locations:manage",
				}),
				expect.objectContaining({
					label: "Services",
					href: "/services",
					section: "Administration",
					requiredPermission: "settings.services:manage",
				}),
				expect.objectContaining({
					label: "Forms",
					href: "/forms",
					section: "Administration",
					requiredPermission: "forms.templates:manage",
				}),
				expect.objectContaining({
					label: "Schedules",
					href: "/schedules",
					section: "Administration",
					requiredPermission: "schedules.slots:manage",
				}),
				expect.objectContaining({
					label: "Payment Channels",
					href: "/payment-channels",
					section: "Administration",
					requiredPermission: "settings.payment-channels:manage",
				}),
				expect.objectContaining({
					label: "Policies",
					href: "/policies",
					section: "Administration",
					requiredPermission: "settings.policies:manage",
				}),
				expect.objectContaining({
					label: "Audit log",
					href: "/audit-log",
					section: "Administration",
					requiredPermission: "audit.logs:read",
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
			getAccessibleNavItems({ roles: [], permissions: ["settings.locations:manage"] }).map(
				item => item.label
			)
		).toContain("Locations")

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["settings.services:manage"] }).map(
				item => item.label
			)
		).toContain("Services")

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["bookings.own:read"] }).map(
				item => item.label
			)
		).toEqual(["Dashboard", "My transactions"])

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["processing.queue:read"] }).map(
				item => item.label
			)
		).toEqual(["Dashboard", "Processing"])

		// PRC-2: the Processing Officer encodes walk-ins.
		expect(
			getAccessibleNavItems({
				roles: [],
				permissions: ["processing.queue:read", "bookings.walk-in:create"],
			}).map(item => item.label)
		).toEqual(["Dashboard", "Processing", "Walk-in"])

		// PRC-3: Approvals needs processing.assessments:approve (Module Admin), not the officer keys.
		expect(
			getAccessibleNavItems({
				roles: [],
				permissions: ["processing.queue:read", "processing.assessments:approve"],
			}).map(item => item.label)
		).toEqual(["Dashboard", "Processing", "Approvals"])

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["bookings.own:create"] }).map(
				item => item.label
			)
		).toEqual(["Dashboard", "Book an appointment"])

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["schedules.slots:manage"] }).map(
				item => item.label
			)
		).toEqual(["Dashboard", "Schedules"])

		// ADM-6: the Policies link needs settings.policies:manage.
		expect(
			getAccessibleNavItems({ roles: [], permissions: ["settings.policies:manage"] }).map(
				item => item.label
			)
		).toEqual(["Dashboard", "Policies"])

		// FRM-1: the Forms link needs forms.templates:manage.
		expect(
			getAccessibleNavItems({ roles: [], permissions: ["forms.templates:manage"] }).map(
				item => item.label
			)
		).toEqual(["Dashboard", "Forms"])

		// CRT-6: Seminars needs certificates.documents:issue, the same key as issuing a document.
		expect(
			getAccessibleNavItems({ roles: [], permissions: ["certificates.documents:issue"] }).map(
				item => item.label
			)
		).toEqual(["Dashboard", "Seminars"])

		// PAY-4: the Cashier role sees the Cashier link and nothing that edits clients or schedules.
		expect(
			getAccessibleNavItems({
				roles: ["Cashier"],
				permissions: [
					"payments.onsite:collect",
					"payments.transactions:read",
					"payments.refunds:request",
					"bookings.all:read",
					"reports.dashboard:read",
				],
			}).map(item => item.label)
		).toEqual(["Dashboard", "Cashier", "Payment exceptions"])

		// ADM-3: the Audit log link needs audit.logs:read.
		expect(
			getAccessibleNavItems({ roles: [], permissions: ["audit.logs:read"] }).map(item => item.label)
		).toEqual(["Dashboard", "Audit log"])

		expect(
			getAccessibleNavItems({ roles: ["Super Admin"], permissions: [] }).map(item => item.label)
		).toEqual([
			"Dashboard",
			"Book an appointment",
			"My transactions",
			"My documents",
			"Processing",
			"Walk-in",
			"Approvals",
			"Seminars",
			"Cashier",
			"Payment exceptions",
			"User Management",
			"Locations",
			"Services",
			"Forms",
			"Schedules",
			"Payment Channels",
			"Policies",
			"Audit log",
		])

		expect(
			getAccessibleNavItems({ roles: [], permissions: ["settings.payment-channels:manage"] }).map(
				item => item.label
			)
		).toEqual(["Dashboard", "Payment Channels"])
	})

	it("resolves mobile header titles from dashboard routes", () => {
		expect(getDashboardRouteTitle("/dashboard")).toBe("Dashboard")
		expect(getDashboardRouteTitle("/user-management")).toBe("User Management")
		expect(getDashboardRouteTitle("/locations")).toBe("Locations")
		expect(getDashboardRouteTitle("/services")).toBe("Services")
		expect(getDashboardRouteTitle("/schedules")).toBe("Schedules")
		expect(getDashboardRouteTitle("/payment-channels")).toBe("Payment Channels")
		expect(getDashboardRouteTitle("/audit-log")).toBe("Audit log")
		expect(getDashboardRouteTitle("/policies")).toBe("Policies")
		expect(getDashboardRouteTitle("/forms/7")).toBe("Forms")
		expect(getDashboardRouteTitle("/book")).toBe("Book an appointment")
		expect(getDashboardRouteTitle("/transactions")).toBe("My transactions")
		expect(getDashboardRouteTitle("/transactions/42")).toBe("My transactions")
		expect(getDashboardRouteTitle("/processing/44")).toBe("Processing")
		expect(getDashboardRouteTitle("/processing/approvals")).toBe("Approvals")
		expect(getDashboardRouteTitle("/processing/walk-in")).toBe("Walk-in")
		expect(getDashboardRouteTitle("/account")).toBe("Account")
		expect(getDashboardRouteTitle("/cashier")).toBe("Cashier")
		expect(getDashboardRouteTitle("/payment-exceptions")).toBe("Payment exceptions")
		expect(getDashboardRouteTitle("/seminars")).toBe("Seminars")
	})

	it("marks only the most specific link active (PRC-3)", () => {
		const hrefs = ["/dashboard", "/processing", "/processing/approvals"]
		expect(getActiveNavHref("/processing/approvals", hrefs)).toBe("/processing/approvals")
		expect(getActiveNavHref("/processing/44", hrefs)).toBe("/processing")
		expect(getActiveNavHref("/processing", hrefs)).toBe("/processing")
		expect(getActiveNavHref("/book", hrefs)).toBeUndefined()
	})
})
