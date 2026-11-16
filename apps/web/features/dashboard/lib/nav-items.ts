import { DashboardSquare01Icon, UserMultipleIcon } from "@hugeicons/core-free-icons"
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
		label: "User Management",
		href: "/user-management",
		icon: UserMultipleIcon,
		section: "Administration",
		requiredPermission: ["users.accounts:read", "users.accounts:manage"],
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
