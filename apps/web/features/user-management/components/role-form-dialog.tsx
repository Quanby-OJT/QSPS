"use client"

import { useState } from "react"

import { ADMIN_ROLE, type PermissionName, type Role } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/core/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/core/components/ui/field"
import { Input } from "@/core/components/ui/input"
import { Textarea } from "@/core/components/ui/textarea"
import { useRateLimitToast } from "@/core/hooks/use-rate-limit-toast"
import {
	useCreateRoleMutation,
	useSetRolePermissionsMutation,
	useUpdateRoleMutation,
} from "@/features/user-management/api/rbac.hooks"
import { PermissionChecklist } from "@/features/user-management/components/permission-checklist"

interface RoleFormDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	role?: Role
}

export function RoleFormDialog({ open, onOpenChange, role }: RoleFormDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
				{open ? (
					<RoleForm key={role?.id ?? "new"} role={role} onClose={() => onOpenChange(false)} />
				) : null}
			</DialogContent>
		</Dialog>
	)
}

function RoleForm({ role, onClose }: { role?: Role; onClose: () => void }) {
	const isEdit = Boolean(role)
	const isAdminRole = role?.name === ADMIN_ROLE
	// ADM-7: seeded roles keep their name (code refers to them by name).
	const isBuiltIn = role?.isSystem === true

	const [name, setName] = useState(role?.name ?? "")
	const [description, setDescription] = useState(role?.description ?? "")
	const [permissions, setPermissions] = useState<PermissionName[]>(role?.permissions ?? [])
	const [formError, setFormError] = useState<string | null>(null)

	const createRole = useCreateRoleMutation()
	const updateRole = useUpdateRoleMutation()
	const setRolePermissions = useSetRolePermissionsMutation()

	const isPending = createRole.isPending || updateRole.isPending || setRolePermissions.isPending

	// Live 429 countdown for whichever write in the submit chain hit the limit.
	const { isActive, secondsLeft } = useRateLimitToast(
		createRole.error ?? updateRole.error ?? setRolePermissions.error,
		{ toastId: "rbac-role-form" }
	)

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()
		setFormError(null)

		const trimmed = name.trim()
		if (!trimmed) {
			setFormError("Name is required")
			return
		}

		try {
			if (isEdit && role) {
				const nextDescription = description.trim() || null
				// Only send what changed, so the audit log shows real changes.
				if (trimmed !== role.name || nextDescription !== role.description) {
					await updateRole.mutateAsync({
						id: role.id,
						...(trimmed !== role.name ? { name: trimmed } : {}),
						description: nextDescription,
					})
				}
				const before = new Set(role.permissions)
				const changed = permissions.length !== before.size || permissions.some(p => !before.has(p))
				if (changed) {
					await setRolePermissions.mutateAsync({ id: role.id, permissions })
				}
			} else {
				const created = await createRole.mutateAsync({
					name: trimmed,
					description: description.trim() || undefined,
				})
				if (permissions.length) {
					await setRolePermissions.mutateAsync({ id: created.id, permissions })
				}
			}
			onClose()
		} catch (err) {
			setFormError(err instanceof Error ? err.message : "Something went wrong")
		}
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle>{isEdit ? "Edit role" : "New role"}</DialogTitle>
				<DialogDescription>
					{isEdit
						? "Update the role details and the permissions it grants."
						: "Create a role and choose which permissions it grants."}
				</DialogDescription>
			</DialogHeader>

			<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
				<Field data-invalid={Boolean(formError)}>
					<FieldLabel htmlFor="role-name">Name</FieldLabel>
					<Input
						id="role-name"
						value={name}
						onChange={e => setName(e.target.value)}
						placeholder="e.g. Editor"
						disabled={isPending || isAdminRole || isBuiltIn}
						aria-invalid={Boolean(formError)}
					/>
					{isBuiltIn ? (
						<p className="text-muted-foreground text-xs">
							Built-in roles keep their name. You can change the description and permissions.
						</p>
					) : null}
				</Field>

				<Field>
					<FieldLabel htmlFor="role-description">Description</FieldLabel>
					<Textarea
						id="role-description"
						value={description}
						onChange={e => setDescription(e.target.value)}
						placeholder="What is this role for?"
						disabled={isPending}
						rows={2}
					/>
				</Field>

				<Field>
					<FieldLabel>Permissions</FieldLabel>
					<PermissionChecklist value={permissions} onChange={setPermissions} disabled={isPending} />
				</Field>

				{formError ? <FieldError>{formError}</FieldError> : null}

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
						Cancel
					</Button>
					<Button type="submit" disabled={isPending || isActive}>
						{isActive
							? `Try again in ${secondsLeft}s`
							: isPending
								? "Saving..."
								: isEdit
									? "Save changes"
									: "Create role"}
					</Button>
				</DialogFooter>
			</form>
		</>
	)
}
