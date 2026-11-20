"use client"

import Link from "next/link"
import {
	ArrowRight01Icon,
	SecurityCheckIcon,
	UserGroupIcon,
	UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { Badge } from "@/core/components/ui/badge"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { canAccess, type AccessProfile } from "@/features/dashboard/lib/access"
import { getAccessibleNavItems } from "@/features/dashboard/lib/nav-items"
import { ClientLocationPicker } from "@/features/locations/components/client-location-picker"
import { useRolesQuery, useUsersQuery } from "@/features/user-management/api/rbac.hooks"

interface DashboardOverviewProps {
	user: {
		name: string | null
		email: string
	}
	access: AccessProfile
}

export function DashboardOverview({ user, access }: DashboardOverviewProps) {
	const canReadUsers = canAccess(access, {
		requiredPermission: ["users.accounts:read", "users.accounts:manage"],
	})
	const canCreateOwnBookings = canAccess(access, {
		requiredPermission: "bookings.own:create",
	})

	const users = useUsersQuery()
	const roles = useRolesQuery()

	// The persisted-cache restore pins `fetchStatus` to `idle`, so raw
	// `isLoading` disagrees with the server render. See `useIsQueryLoading`.
	const isQueryLoading = useIsQueryLoading()

	const firstName = user.name?.trim().split(/\s+/)[0] || "there"
	const quickActions = getAccessibleNavItems(access).filter(item => item.href !== "/dashboard")

	return (
		<div className="flex w-full flex-col gap-8">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div className="min-w-0">
					<h1 className="text-2xl font-bold tracking-tight">Welcome back, {firstName}</h1>
					<p className="text-muted-foreground text-sm">Here is an overview of your workspace.</p>
				</div>
				{access.roles.length ? (
					<div className="flex flex-wrap gap-1">
						{access.roles.map(role => (
							<Badge key={role} variant="secondary">
								{role}
							</Badge>
						))}
					</div>
				) : null}
			</header>

			{canCreateOwnBookings ? <ClientLocationPicker /> : null}

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					icon={SecurityCheckIcon}
					label="Your permissions"
					value={access.permissions.length}
					hint="Granted on your account"
				/>
				{canReadUsers ? (
					<StatCard
						icon={UserGroupIcon}
						label="Users"
						value={users.data?.total}
						hint="Across all roles"
						isLoading={isQueryLoading(users)}
						isError={users.isError}
					/>
				) : null}
				{canReadUsers ? (
					<StatCard
						icon={UserMultipleIcon}
						label="Roles"
						value={roles.data?.length}
						hint="Defined in the workspace"
						isLoading={isQueryLoading(roles)}
						isError={roles.isError}
					/>
				) : null}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Quick actions</CardTitle>
					<CardDescription>Jump to a workspace destination you can access.</CardDescription>
				</CardHeader>
				<CardContent>
					{quickActions.length ? (
						<div className="grid gap-3 sm:grid-cols-2">
							{quickActions.map(item => (
								<Link
									key={item.href}
									href={item.href}
									className="group/action border-border hover:bg-muted/60 hover:border-ring/40 focus-visible:border-ring focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg border p-3 outline-none transition-colors focus-visible:ring-[3px]"
								>
									<div className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
										<HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-5" />
									</div>
									<span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
									<HugeiconsIcon
										icon={ArrowRight01Icon}
										strokeWidth={2}
										className="text-muted-foreground size-4 transition-transform group-hover/action:translate-x-0.5"
									/>
								</Link>
							))}
						</div>
					) : (
						<p className="text-muted-foreground text-sm">No destinations available.</p>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

interface StatCardProps {
	icon: IconSvgElement
	label: string
	value: number | undefined
	hint: string
	isLoading?: boolean
	isError?: boolean
}

function StatCard({ icon, label, value, hint, isLoading, isError }: StatCardProps) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-2">
					<CardDescription>{label}</CardDescription>
					<div className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md">
						<HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
					</div>
				</div>
				{isLoading ? (
					<Skeleton className="mt-1 h-8 w-16" />
				) : isError ? (
					<p className="text-destructive text-2xl font-bold tabular-nums">—</p>
				) : (
					<p className="text-2xl font-bold tabular-nums">{value ?? 0}</p>
				)}
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-xs">{isError ? "Failed to load" : hint}</p>
			</CardContent>
		</Card>
	)
}
