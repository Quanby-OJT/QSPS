import {
	AccountSetting01Icon,
	Add01Icon,
	CheckmarkCircle02Icon,
	DashboardSquare01Icon,
	File01Icon,
	ShieldKeyIcon,
	UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import { type IconSvgElement } from "@hugeicons/react"

import { type PermissionName } from "@repo/contracts"

import { canAccess, type AccessProfile, type RoleRequirement } from "./access"

type DashboardHref = `/${string}`

export interface DashboardNavItem {
	label: string
	href: DashboardHref
	icon: IconSvgElement
	section?: string
	requiredPermission?: PermissionName | readonly PermissionName[]
	requiredRole?: RoleRequirement
}

export const navItems: readonly DashboardNavItem[] = [
	{
		label: "Dashboard",
		href: "/dashboard",
		icon: DashboardSquare01Icon,
	},
	{
		label: "Book an appointment",
		href: "/book",
		icon: Add01Icon,
		requiredPermission: "bookings.own:create",
	},
	{
		label: "My documents",
		href: "/documents",
		icon: File01Icon,
		requiredPermission: "certificates.own:read",
	},
	{
		label: "Processing",
		href: "/processing",
		icon: CheckmarkCircle02Icon,
		requiredPermission: "processing.queue:read",
	},
	{
		label: "User Management",
		href: "/user-management",
		icon: UserMultipleIcon,
		section: "Administration",
		requiredPermission: ["users.accounts:read", "users.accounts:manage"],
	},
	{
		label: "Locations",
		href: "/locations",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "settings.locations:manage",
	},
	{
		label: "Services",
		href: "/services",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "settings.services:manage",
	},
	{
		label: "Forms",
		href: "/forms",
		icon: File01Icon,
		section: "Administration",
		requiredPermission: "forms.templates:manage",
	},
	{
		label: "Schedules",
		href: "/schedules",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "schedules.slots:manage",
	},
	{
		label: "Payment Channels",
		href: "/payment-channels",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "settings.payment-channels:manage",
	},
	{
		label: "Policies",
		href: "/policies",
		icon: AccountSetting01Icon,
		section: "Administration",
		requiredPermission: "settings.policies:manage",
	},
	{
		label: "Audit log",
		href: "/audit-log",
		icon: ShieldKeyIcon,
		section: "Administration",
		requiredPermission: "audit.logs:read",
	},
]

export const dashboardRouteTitles: readonly Pick<DashboardNavItem, "href" | "label">[] = [
	...navItems.map(({ href, label }) => ({ href, label })),
	{
		label: "Account",
		href: "/account",
	},
]

export function getDashboardRouteTitle(pathname: string): string {
	const currentRoute = dashboardRouteTitles.find(
		route => pathname === route.href || pathname.startsWith(`${route.href}/`)
	)

	return currentRoute?.label ?? "Dashboard"
}

export function getAccessibleNavItems(access: AccessProfile): DashboardNavItem[] {
	return navItems.filter(item =>
		canAccess(access, {
			requiredPermission: item.requiredPermission,
			requiredRole: item.requiredRole,
		})
	)
}
