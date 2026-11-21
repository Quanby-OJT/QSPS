"use client"

import { useMemo, useState } from "react"
import {
	Add01Icon,
	Cancel01Icon,
	Delete02Icon,
	Download01Icon,
	PencilEdit02Icon,
	Search01Icon,
	UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import {
	MODULE_ADMIN_ASSIGNABLE_ROLES,
	type UserAccountStatus,
	type UserAccountType,
	type UserExportFormat,
	type UserWithRoles,
} from "@repo/contracts"

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/core/components/ui/alert-dialog"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/core/components/ui/empty"
import { Input } from "@/core/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/core/components/ui/select"
import { Skeleton } from "@/core/components/ui/skeleton"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { useRateLimitToast } from "@/core/hooks/use-rate-limit-toast"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	useAssignRoleMutation,
	useDeleteUserMutation,
	useExportUsersMutation,
	useRemoveRoleMutation,
	useRolesQuery,
	useSetUserStatusMutation,
	useUsersQuery,
} from "@/features/user-management/api/rbac.hooks"
import { StaffUserDialog } from "@/features/user-management/components/staff-user-dialog"

const ALL_VALUE = "__all__"

/**
 * Labels for the filter dropdowns. Passed to `Select` as `items` so the
 * trigger shows the label of the chosen option, never the raw value
 * (it used to print "__all__").
 */
const STATUS_ITEMS = {
	[ALL_VALUE]: "Active & disabled",
	active: "Active only",
	disabled: "Disabled only",
	deleted: "Deleted (archived)",
} as const

const ACCOUNT_TYPE_ITEMS = {
	[ALL_VALUE]: "All account types",
	staff: "Staff",
	client: "Client",
} as const

/** BOQ status colours (UI-1): green active, grey disabled, red deleted. */
const STATUS_BADGE: Record<UserAccountStatus, string> = {
	active: "border-success/30 bg-success/10 text-success",
	disabled: "border-border bg-muted text-muted-foreground",
	deleted: "border-destructive/30 bg-destructive/10 text-destructive",
}

const STATUS_LABEL: Record<UserAccountStatus, string> = {
	active: "Active",
	disabled: "Disabled",
	deleted: "Deleted",
}

interface UsersPanelProps {
	/** users.roles:manage, decided on the server (ADM-2). */
	canManageRoles: boolean
}

export function UsersPanel({ canManageRoles }: UsersPanelProps) {
	const [search, setSearch] = useState("")
	const [roleFilter, setRoleFilter] = useState<string>(ALL_VALUE)
	const [statusFilter, setStatusFilter] = useState<string>(ALL_VALUE)
	const [accountTypeFilter, setAccountTypeFilter] = useState<string>(ALL_VALUE)
	const [page, setPage] = useState(1)
	const pageSize = 20

	const activeFilters = useMemo(
		() => ({
			search: search.trim() || undefined,
			role: roleFilter === ALL_VALUE ? undefined : roleFilter,
			status: statusFilter === ALL_VALUE ? undefined : (statusFilter as UserAccountStatus),
			accountType:
				accountTypeFilter === ALL_VALUE ? undefined : (accountTypeFilter as UserAccountType),
		}),
		[search, roleFilter, statusFilter, accountTypeFilter]
	)

	const usersQuery = useUsersQuery({ ...activeFilters, page, pageSize })
	const { data, isError, error } = usersQuery
	const users = data?.items ?? []
	// ADM-2: a Module Admin cannot read roles (no users.roles:manage), so the
	// list is not requested. They may still give the roles below Module Admin.
	const { data: roles } = useRolesQuery(canManageRoles)

	const isQueryLoading = useIsQueryLoading()

	const assignRole = useAssignRoleMutation()
	const removeRole = useRemoveRoleMutation()
	const setStatus = useSetUserStatusMutation()
	const deleteUser = useDeleteUserMutation()
	const exportUsers = useExportUsersMutation()

	const assignRateLimit = useRateLimitToast(assignRole.error, { toastId: "rbac-assign-role" })
	const removeRateLimit = useRateLimitToast(removeRole.error, { toastId: "rbac-remove-role" })

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editingUser, setEditingUser] = useState<UserWithRoles | undefined>(undefined)
	const [userToDelete, setUserToDelete] = useState<UserWithRoles | null>(null)
	const [actionError, setActionError] = useState<string | null>(null)

	const allRoleNames = useMemo(
		() =>
			canManageRoles ? (roles ?? []).map(role => role.name) : [...MODULE_ADMIN_ASSIGNABLE_ROLES],
		[roles, canManageRoles]
	)
	const roleItems = useMemo(
		() => ({
			[ALL_VALUE]: "All roles",
			...Object.fromEntries(allRoleNames.map(name => [name, name])),
		}),
		[allRoleNames]
	)

	function openCreateStaff() {
		setEditingUser(undefined)
		setDialogOpen(true)
	}

	function openEditUser(user: UserWithRoles) {
		setEditingUser(user)
		setDialogOpen(true)
	}

	async function handleExport(format: UserExportFormat) {
		setActionError(null)
		try {
			await exportUsers.mutateAsync({ ...activeFilters, format })
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to export users")
		}
	}

	async function handleToggleStatus(user: UserWithRoles) {
		setActionError(null)
		try {
			await setStatus.mutateAsync({
				userId: user.id,
				isActive: user.status === "disabled",
			})
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to update account status")
		}
	}

	async function confirmDeleteUser() {
		if (!userToDelete) return
		setActionError(null)
		try {
			await deleteUser.mutateAsync(userToDelete.id)
			setUserToDelete(null)
		} catch (err) {
			setActionError(err instanceof Error ? err.message : "Failed to delete user")
			setUserToDelete(null)
		}
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
					<h2 className="text-lg font-bold tracking-tight">Users</h2>
					<p className="text-muted-foreground text-sm">
						Create staff accounts, assign roles, manage status, and export user records.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => handleExport("csv")}
						disabled={exportUsers.isPending}
					>
						<HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
						CSV
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => handleExport("xlsx")}
						disabled={exportUsers.isPending}
					>
						<HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
						Excel
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => handleExport("pdf")}
						disabled={exportUsers.isPending}
					>
						<HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
						PDF
					</Button>
					<Button size="sm" onClick={openCreateStaff}>
						<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
						New staff account
					</Button>
				</div>
			</div>

			{/* Search and filters */}
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
				<div className="relative">
					<HugeiconsIcon
						icon={Search01Icon}
						strokeWidth={2}
						className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4"
					/>
					<Input
						value={search}
						onChange={e => {
							setSearch(e.target.value)
							setPage(1)
						}}
						placeholder="Search name or email..."
						className="pl-8"
					/>
				</div>

				<Select
					items={roleItems}
					value={roleFilter}
					onValueChange={val => {
						setRoleFilter(val ?? ALL_VALUE)
						setPage(1)
					}}
				>
					<SelectTrigger className="w-full" aria-label="Filter by role">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_VALUE}>All roles</SelectItem>
						{allRoleNames.map(name => (
							<SelectItem key={name} value={name}>
								{name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					items={STATUS_ITEMS}
					value={statusFilter}
					onValueChange={val => {
						setStatusFilter(val ?? ALL_VALUE)
						setPage(1)
					}}
				>
					<SelectTrigger className="w-full" aria-label="Filter by status">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_VALUE}>Active & disabled</SelectItem>
						<SelectItem value="active">Active only</SelectItem>
						<SelectItem value="disabled">Disabled only</SelectItem>
						<SelectItem value="deleted">Deleted (archived)</SelectItem>
					</SelectContent>
				</Select>

				<Select
					items={ACCOUNT_TYPE_ITEMS}
					value={accountTypeFilter}
					onValueChange={val => {
						setAccountTypeFilter(val ?? ALL_VALUE)
						setPage(1)
					}}
				>
					<SelectTrigger className="w-full" aria-label="Filter by account type">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_VALUE}>All account types</SelectItem>
						<SelectItem value="staff">Staff</SelectItem>
						<SelectItem value="client">Client</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{actionError ? <p className="text-destructive text-sm">{actionError}</p> : null}

			{isQueryLoading(usersQuery) ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : null}

			{isError ? (
				<p className="text-destructive text-sm">
					{error instanceof Error ? error.message : "Failed to load users"}
				</p>
			) : null}

			{users.length > 0 ? (
				<div className="overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader className="bg-muted/50">
							<TableRow>
								<TableHead>User</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Roles</TableHead>
								{canManageRoles ? <TableHead className="w-44">Assign role</TableHead> : null}
								<TableHead className="w-0 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map(user => {
								const assigned = new Set(user.roles)
								const available = allRoleNames.filter(name => !assigned.has(name))
								const isDeleted = user.status === "deleted"
								return (
									<TableRow key={user.id}>
										<TableCell className="align-top">
											<div className="font-medium">{user.name ?? "—"}</div>
											<div className="text-muted-foreground text-xs">{user.email}</div>
										</TableCell>
										<TableCell className="align-top">
											<Badge
												variant="outline"
												className={
													user.accountType === "staff"
														? "bg-navy text-navy-foreground border-navy"
														: undefined
												}
											>
												{user.accountType === "staff" ? "Staff" : "Client"}
											</Badge>
										</TableCell>
										<TableCell className="align-top">
											<Badge variant="outline" className={STATUS_BADGE[user.status]}>
												{STATUS_LABEL[user.status]}
											</Badge>
										</TableCell>
										<TableCell className="align-top">
											{user.roles.length ? (
												<div className="flex flex-wrap gap-1">
													{user.roles.map(roleName => (
														<Badge key={roleName} variant="outline" className="gap-1 pr-1">
															{roleName}
															{!isDeleted && canManageRoles ? (
																<button
																	type="button"
																	onClick={() => removeRole.mutate({ userId: user.id, roleName })}
																	disabled={removeRole.isPending || removeRateLimit.isActive}
																	className="hover:text-destructive inline-flex items-center"
																	aria-label={`Remove ${roleName} from ${user.email || user.id}`}
																>
																	<HugeiconsIcon
																		icon={Cancel01Icon}
																		strokeWidth={2}
																		className="size-3"
																	/>
																</button>
															) : null}
														</Badge>
													))}
												</div>
											) : (
												<span className="text-muted-foreground text-xs">No roles</span>
											)}
										</TableCell>
										{canManageRoles ? (
											<TableCell className="align-top">
												<Select
													value={null}
													onValueChange={value => {
														if (typeof value === "string") {
															assignRole.mutate({ userId: user.id, roleName: value })
														}
													}}
													disabled={
														isDeleted ||
														available.length === 0 ||
														assignRole.isPending ||
														assignRateLimit.isActive
													}
												>
													<SelectTrigger size="sm" className="w-full">
														<SelectValue>Add role</SelectValue>
													</SelectTrigger>
													<SelectContent>
														{available.map(name => (
															<SelectItem key={name} value={name}>
																{name}
															</SelectItem>
														))}
													</SelectContent>
												</Select>
											</TableCell>
										) : null}
										<TableCell className="align-top">
											{!isDeleted ? (
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="icon-sm"
														onClick={() => openEditUser(user)}
														aria-label={`Edit ${user.name ?? user.id}`}
													>
														<HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleToggleStatus(user)}
														disabled={setStatus.isPending}
													>
														{user.status === "disabled" ? "Enable" : "Disable"}
													</Button>
													<Button
														variant="ghost"
														size="icon-sm"
														onClick={() => setUserToDelete(user)}
														aria-label={`Delete ${user.name ?? user.id}`}
													>
														<HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
													</Button>
												</div>
											) : null}
										</TableCell>
									</TableRow>
								)
							})}
						</TableBody>
					</Table>
				</div>
			) : null}

			{data && data.total > 0 ? (
				<div className="flex items-center justify-between text-sm">
					<span className="text-muted-foreground">
						Showing page {data.page} of {data.totalPages} ({data.total} total)
					</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage(p => Math.max(1, p - 1))}
							disabled={data.page <= 1}
						>
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
							disabled={data.page >= data.totalPages}
						>
							Next
						</Button>
					</div>
				</div>
			) : null}

			{!isQueryLoading(usersQuery) && !isError && users.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<HugeiconsIcon icon={UserGroupIcon} strokeWidth={2} />
						</EmptyMedia>
						<EmptyTitle>No users found</EmptyTitle>
						<EmptyDescription>
							Adjust your search or filters, or create a new staff account.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}

			<StaffUserDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				roleNames={allRoleNames}
				user={editingUser}
			/>

			<AlertDialog
				open={Boolean(userToDelete)}
				onOpenChange={open => !open && setUserToDelete(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete user account</AlertDialogTitle>
						<AlertDialogDescription>
							{userToDelete
								? `Remove "${userToDelete.name ?? userToDelete.email}" from the active user list? Active sessions will be revoked immediately, and historical records and audit logs will be preserved.`
								: ""}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={confirmDeleteUser}
							disabled={deleteUser.isPending}
						>
							{deleteUser.isPending ? "Deleting..." : "Delete account"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
