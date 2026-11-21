"use client"

import { useState } from "react"

import type { Role, UserWithRoles } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { Checkbox } from "@/core/components/ui/checkbox"
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
import { useRateLimitToast } from "@/core/hooks/use-rate-limit-toast"
import {
	useCreateStaffUserMutation,
	useUpdateUserMutation,
} from "@/features/user-management/api/rbac.hooks"

interface StaffUserDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	roles: Role[]
	user?: UserWithRoles
}

export function StaffUserDialog({ open, onOpenChange, roles, user }: StaffUserDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				{open ? (
					<StaffUserForm
						key={user?.id ?? "new-staff"}
						roles={roles}
						user={user}
						onClose={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	)
}

function StaffUserForm({
	roles,
	user,
	onClose,
}: {
	roles: Role[]
	user?: UserWithRoles
	onClose: () => void
}) {
	const isEdit = Boolean(user)
	const [name, setName] = useState(user?.name ?? "")
	const [email, setEmail] = useState(user?.email ?? "")
	const [selectedRoles, setSelectedRoles] = useState<string[]>([])
	const [formError, setFormError] = useState<string | null>(null)

	const createStaff = useCreateStaffUserMutation()
	const updateUser = useUpdateUserMutation()

	const isPending = createStaff.isPending || updateUser.isPending
	const { isActive, secondsLeft } = useRateLimitToast(createStaff.error ?? updateUser.error, {
		toastId: "rbac-staff-user-form",
	})

	function toggleRole(roleName: string, checked: boolean) {
		if (checked) {
			setSelectedRoles(prev => [...prev, roleName])
		} else {
			setSelectedRoles(prev => prev.filter(r => r !== roleName))
		}
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()
		setFormError(null)

		const trimmedName = name.trim()
		const trimmedEmail = email.trim()

		if (!trimmedName) {
			setFormError("Full name is required")
			return
		}
		if (!trimmedEmail) {
			setFormError("Email address is required")
			return
		}
		if (!isEdit && selectedRoles.length === 0) {
			setFormError("Select at least one role for the staff account")
			return
		}

		try {
			if (isEdit && user) {
				await updateUser.mutateAsync({
					userId: user.id,
					name: trimmedName,
					...(trimmedEmail ? { email: trimmedEmail } : {}),
				})
			} else {
				await createStaff.mutateAsync({
					name: trimmedName,
					email: trimmedEmail,
					roles: selectedRoles,
				})
			}
			onClose()
		} catch (err) {
			setFormError(err instanceof Error ? err.message : "Something went wrong")
		}
	}

	const assignableRoles = roles.filter(r => r.name !== "Client")

	return (
		<>
			<DialogHeader>
				<DialogTitle>{isEdit ? "Edit user account" : "Create staff account"}</DialogTitle>
				<DialogDescription>
					{isEdit
						? "Update the user's name or email address."
						: "Create a BOQ staff account and send an invitation email to set their password."}
				</DialogDescription>
			</DialogHeader>

			<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
				<Field data-invalid={Boolean(formError)}>
					<FieldLabel htmlFor="staff-name">Full name</FieldLabel>
					<Input
						id="staff-name"
						value={name}
						onChange={e => setName(e.target.value)}
						placeholder="e.g. Maria Clara Santos"
						disabled={isPending}
					/>
				</Field>

				<Field data-invalid={Boolean(formError)}>
					<FieldLabel htmlFor="staff-email">Email address</FieldLabel>
					<Input
						id="staff-email"
						type="email"
						value={email}
						onChange={e => setEmail(e.target.value)}
						placeholder="name@boq.gov.ph"
						disabled={isPending}
					/>
				</Field>

				{!isEdit ? (
					<Field>
						<FieldLabel>Roles</FieldLabel>
						<div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-2">
							{assignableRoles.map(role => (
								<Field key={role.id} orientation="horizontal">
									<Checkbox
										id={`staff-role-${role.id}`}
										checked={selectedRoles.includes(role.name)}
										onCheckedChange={checked => toggleRole(role.name, checked === true)}
										disabled={isPending}
									/>
									<FieldLabel htmlFor={`staff-role-${role.id}`} className="font-normal">
										{role.name}
									</FieldLabel>
								</Field>
							))}
						</div>
					</Field>
				) : null}

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
									: "Create & send invite"}
					</Button>
				</DialogFooter>
			</form>
		</>
	)
}