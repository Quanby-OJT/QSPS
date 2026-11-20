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

import type {
	UserAccountStatus,
	UserAccountType,
	UserExportFormat,
	UserWithRoles,
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

export function UsersPanel() {
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
	const { data: roles } = useRolesQuery()

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

	const allRoleNames = useMemo(() => (roles ?? []).map(role => role.name), [roles])

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
					<h2 className="text-lg font-semibold">Users</h2>
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
					value={roleFilter}
					onValueChange={val => {
						setRoleFilter(val ?? ALL_VALUE)
						setPage(1)
					}}
				>
					<SelectTrigger className="w-full">
						<SelectValue>{roleFilter === ALL_VALUE ? "All roles" : roleFilter}</SelectValue>
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
					value={statusFilter}
					onValueChange={val => {
						setStatusFilter(val ?? ALL_VALUE)
						setPage(1)
					}}
				>
					<SelectTrigger className="w-full">
						<SelectValue>
							{statusFilter === "active"
								? "Active only"
								: statusFilter === "disabled"
									? "Disabled only"
									: statusFilter === "deleted"
										? "Deleted (archived)"
										: "Active & disabled"}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_VALUE}>Active & disabled</SelectItem>
						<SelectItem value="active">Active only</SelectItem>
						<SelectItem value="disabled">Disabled only</SelectItem>
						<SelectItem value="deleted">Deleted (archived)</SelectItem>
					</SelectContent>
				</Select>

				<Select
					value={accountTypeFilter}
					onValueChange={val => {
						setAccountTypeFilter(val ?? ALL_VALUE)
						setPage(1)
					}}
				>
					<SelectTrigger className="w-full">
						<SelectValue>
							{accountTypeFilter === "staff"
								? "Staff"
								: accountTypeFilter === "client"
									? "Client"
									: "All account types"}
						</SelectValue>
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
						<TableHeader>
							<TableRow>
								<TableHead>User</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Roles</TableHead>
								<TableHead className="w-44">Assign role</TableHead>
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
											<Badge variant={user.accountType === "staff" ? "secondary" : "outline"}>
												{user.accountType}
											</Badge>
										</TableCell>
										<TableCell className="align-top">
											<Badge
												variant={
													user.status === "active"
														? "default"
														: user.status === "disabled"
															? "secondary"
															: "destructive"
												}
											>
												{user.status}
											</Badge>
										</TableCell>
										<TableCell className="align-top">
											{user.roles.length ? (
												<div className="flex flex-wrap gap-1">
													{user.roles.map(roleName => (
														<Badge key={roleName} variant="outline" className="gap-1 pr-1">
															{roleName}
															{!isDeleted ? (
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
				roles={roles ?? []}
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