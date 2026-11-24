"use client"

import { useState } from "react"
import {
	Add01Icon,
	Delete02Icon,
	PencilEdit02Icon,
	UserMultipleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { ADMIN_ROLE, type Role } from "@repo/contracts"

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
import { useDeleteRoleMutation, useRolesQuery } from "@/features/user-management/api/rbac.hooks"
import { RoleFormDialog } from "@/features/user-management/components/role-form-dialog"

export function RolesPanel() {
	const rolesQuery = useRolesQuery()
	const { data: roles, isError, error } = rolesQuery

	// The persisted-cache restore pins `fetchStatus` to `idle`, so raw
	// `isLoading` disagrees with the server render. See `useIsQueryLoading`.
	const isQueryLoading = useIsQueryLoading()

	const deleteRole = useDeleteRoleMutation()
	const deleteRateLimit = useRateLimitToast(deleteRole.error, { toastId: "rbac-role-delete" })

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editingRole, setEditingRole] = useState<Role | undefined>(undefined)
	const [roleToDelete, setRoleToDelete] = useState<Role | null>(null)

	function openCreate() {
		setEditingRole(undefined)
		setDialogOpen(true)
	}

	function openEdit(role: Role) {
		setEditingRole(role)
		setDialogOpen(true)
	}

	async function confirmDelete() {
		if (!roleToDelete) return
		try {
			await deleteRole.mutateAsync(roleToDelete.id)
		} catch {
			// The error is shown under the table from the mutation's state.
		}
		setRoleToDelete(null)
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div>
					<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
					<h2 className="text-lg font-bold tracking-tight">Roles</h2>
					<p className="text-muted-foreground text-sm">
						Create roles and choose which permissions they grant.
					</p>
				</div>
				<Button onClick={openCreate} size="sm">
					<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
					New role
				</Button>
			</div>

			{isQueryLoading(rolesQuery) ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : null}

			{isError ? (
				<p className="text-destructive text-sm">
					{error instanceof Error ? error.message : "Failed to load roles"}
				</p>
			) : null}

			{deleteRole.error ? (
				<p className="text-destructive text-sm" role="alert">
					{deleteRole.error.message}
				</p>
			) : null}

			{roles && roles.length > 0 ? (
				<div className="rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Role</TableHead>
								<TableHead>Permissions</TableHead>
								<TableHead className="text-right">Users</TableHead>
								<TableHead className="w-0">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{roles.map(role => {
								const isAdmin = role.name === ADMIN_ROLE
								// ADM-7: the API refuses these too; the buttons say why up front.
								const deleteBlockedReason = isAdmin
									? `The ${ADMIN_ROLE} role cannot be deleted`
									: role.isSystem
										? "Built-in roles cannot be deleted"
										: role.userCount > 0
											? `Remove it from ${role.userCount === 1 ? "its 1 user" : `its ${role.userCount} users`} first`
											: null
								return (
									<TableRow key={role.id}>
										<TableCell className="align-top">
											<div className="flex items-center gap-2 font-medium">
												{role.name}
												{role.isSystem ? (
													<Badge
														variant="outline"
														className="border-navy/30 text-navy dark:border-border dark:text-muted-foreground text-[10px]"
													>
														Built-in
													</Badge>
												) : null}
											</div>
											{role.description ? (
												<div className="text-muted-foreground text-xs">{role.description}</div>
											) : null}
										</TableCell>
										<TableCell className="align-top">
											{isAdmin ? (
												<Badge variant="secondary">All permissions</Badge>
											) : role.permissions.length ? (
												<span className="text-sm">
													{role.permissions.length === 1
														? "1 permission"
														: `${role.permissions.length} permissions`}
												</span>
											) : (
												<span className="text-muted-foreground text-xs">None</span>
											)}
										</TableCell>
										<TableCell className="text-right align-top tabular-nums">
											{role.userCount}
										</TableCell>
										<TableCell className="align-top">
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="icon-sm"
													onClick={() => openEdit(role)}
													disabled={isAdmin}
													title={isAdmin ? `The ${ADMIN_ROLE} role cannot be changed` : undefined}
													aria-label={`Edit ${role.name}`}
												>
													<HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													onClick={() => setRoleToDelete(role)}
													disabled={deleteBlockedReason !== null}
													title={deleteBlockedReason ?? undefined}
													aria-label={`Delete ${role.name}`}
												>
													<HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								)
							})}
						</TableBody>
					</Table>
				</div>
			) : null}

			{roles && roles.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<HugeiconsIcon icon={UserMultipleIcon} strokeWidth={2} />
						</EmptyMedia>
						<EmptyTitle>No roles yet</EmptyTitle>
						<EmptyDescription>Create your first role to start granting access.</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : null}

			<RoleFormDialog open={dialogOpen} onOpenChange={setDialogOpen} role={editingRole} />

			<AlertDialog
				open={Boolean(roleToDelete)}
				onOpenChange={open => !open && setRoleToDelete(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete role</AlertDialogTitle>
						<AlertDialogDescription>
							{roleToDelete
								? `Delete "${roleToDelete.name}"? It is not assigned to anyone, and this cannot be undone.`
								: ""}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={confirmDelete}
							disabled={deleteRole.isPending || deleteRateLimit.isActive}
						>
							{deleteRateLimit.isActive
								? `Try again in ${deleteRateLimit.secondsLeft}s`
								: deleteRole.isPending
									? "Deleting..."
									: "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
