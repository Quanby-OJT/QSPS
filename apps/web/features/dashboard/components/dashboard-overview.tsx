"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowRight01Icon, UserGroupIcon, UserMultipleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

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
		<div className="flex w-full flex-col gap-6">
			{/* Welcome banner: navy, gold accent line, BOQ seal (UI-1). */}
			<header className="bg-navy text-navy-foreground relative overflow-hidden rounded-xl p-6 sm:p-8">
				<div
					aria-hidden
					className="bg-gold/10 pointer-events-none absolute -top-16 -right-16 size-56 rounded-full"
				/>
				<div className="relative flex flex-wrap items-center justify-between gap-6">
					<div className="min-w-0">
						<div className="bg-gold mb-3 h-1 w-12 rounded-full" />
						<h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
							Welcome back, {firstName}
						</h1>
						<p className="text-navy-foreground/75 mt-1 text-sm">
							{!canReadUsers && canCreateOwnBookings
								? "Book a quarantine service, then pay and track it here."
								: "Here is an overview of your workspace."}
						</p>
						{access.roles.length ? (
							<div className="mt-4 flex flex-wrap gap-1.5">
								{access.roles.map(role => (
									<span
										key={role}
										className="border-gold/40 text-gold rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide uppercase"
									>
										{role}
									</span>
								))}
							</div>
						) : null}
					</div>
					<Image
						src="/brand/boq.png"
						alt=""
						width={88}
						height={88}
						className="hidden size-20 shrink-0 rounded-full bg-white/95 p-1 sm:block"
					/>
				</div>
			</header>

			{canCreateOwnBookings ? <ClientLocationPicker /> : null}

			{canReadUsers ? (
				<div className="grid gap-4 sm:grid-cols-2">
					<StatCard
						icon={UserGroupIcon}
						label="Users"
						value={users.data?.total}
						hint="Across all roles"
						isLoading={isQueryLoading(users)}
						isError={users.isError}
					/>
					<StatCard
						icon={UserMultipleIcon}
						label="Roles"
						value={roles.data?.length}
						hint="Defined in the workspace"
						isLoading={isQueryLoading(roles)}
						isError={roles.isError}
					/>
				</div>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Quick actions</CardTitle>
					<CardDescription>Jump to a page you can access.</CardDescription>
				</CardHeader>
				<CardContent>
					{quickActions.length ? (
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{quickActions.map(item => (
								<Link
									key={item.href}
									href={item.href}
									className="group/action border-border hover:border-primary/40 hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-ring/50 flex items-center gap-3 rounded-lg border p-3 transition-all outline-none hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-[3px] motion-reduce:hover:translate-y-0"
								>
									<div className="bg-primary/10 text-primary group-hover/action:bg-primary group-hover/action:text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors">
										<HugeiconsIcon icon={item.icon} strokeWidth={2} className="size-5" />
									</div>
									<span className="min-w-0 flex-1 truncate text-sm font-semibold">
										{item.label}
									</span>
									<HugeiconsIcon
										icon={ArrowRight01Icon}
										strokeWidth={2}
										className="text-muted-foreground group-hover/action:text-primary size-4 transition-transform group-hover/action:translate-x-0.5"
									/>
								</Link>
							))}
						</div>
					) : (
						<p className="text-muted-foreground text-sm">No pages available yet.</p>
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
		<Card className="border-t-gold border-t-4">
			<CardHeader>
				<div className="flex items-center justify-between gap-2">
					<CardDescription className="text-xs font-semibold tracking-wide uppercase">
						{label}
					</CardDescription>
					<div className="bg-navy text-gold flex size-9 items-center justify-center rounded-lg">
						<HugeiconsIcon icon={icon} strokeWidth={2} className="size-4" />
					</div>
				</div>
				{isLoading ? (
					<Skeleton className="mt-1 h-9 w-16" />
				) : isError ? (
					<p className="text-destructive text-3xl font-bold tabular-nums">—</p>
				) : (
					<p className="text-3xl font-bold tabular-nums">{value ?? 0}</p>
				)}
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-xs">{isError ? "Failed to load" : hint}</p>
			</CardContent>
		</Card>
	)
}
