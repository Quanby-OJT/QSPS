"use client"

import { useState } from "react"
import Link from "next/link"
import { useForm } from "@tanstack/react-form"

import { Button, buttonVariants } from "@/core/components/ui/button"
import { Card, CardContent } from "@/core/components/ui/card"
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/core/components/ui/field"
import { replaceLocation } from "@/core/lib/navigate"
import { cn } from "@/core/lib/utils"
import { PasswordInput } from "@/features/auth/components/password-input"

import {
	useDisableTwoFactorMutation,
	useGenerateRecoveryCodesMutation,
} from "../api/two-factor.hooks"
import { PasswordConfirmSchema } from "../api/two-factor.schema"
import { RecoveryCodes } from "./recovery-codes"

type Action = "codes" | "disable" | null

/** Asks for the password once more, then runs a security change. */
function PasswordStep({
	label,
	danger,
	pending,
	error,
	onConfirm,
	onCancel,
}: {
	label: string
	danger?: boolean
	pending: boolean
	error: Error | null
	onConfirm: (password: string) => Promise<unknown>
	onCancel: () => void
}) {
	const form = useForm({
		defaultValues: { password: "" },
		onSubmit: async ({ value }) => {
			await onConfirm(value.password).catch(() => null)
		},
	})

	return (
		<form
			className="bg-muted/50 rounded-lg border p-4"
			onSubmit={e => {
				e.preventDefault()
				form.handleSubmit()
			}}
		>
			<FieldGroup>
				{error && (
					<div
						role="alert"
						className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm"
					>
						{error.message || "An unexpected error occurred"}
					</div>
				)}
				<form.Field
					name="password"
					validators={{ onSubmit: PasswordConfirmSchema }}
					children={field => {
						const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
						return (
							<Field data-invalid={isInvalid}>
								<FieldLabel htmlFor={`${label}-password`}>Confirm your password</FieldLabel>
								<PasswordInput
									id={`${label}-password`}
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={e => field.handleChange(e.target.value)}
									aria-invalid={isInvalid}
									autoComplete="current-password"
									required
									disabled={pending}
								/>
								{isInvalid && <FieldError errors={field.state.meta.errors} />}
							</Field>
						)
					}}
				/>
				<div className="grid grid-cols-2 gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={onCancel}
						disabled={pending}
						className="hover:cursor-pointer"
					>
						Cancel
					</Button>
					<Button
						type="submit"
						variant={danger ? "destructive" : "default"}
						disabled={pending}
						className="hover:cursor-pointer"
					>
						{pending ? "Working..." : label}
					</Button>
				</div>
			</FieldGroup>
		</form>
	)
}

/**
 * Sign-in security settings (AUTH-2). Clients can turn two-factor on and off.
 * Staff must keep it on (the server refuses), so they only get new recovery
 * codes here.
 */
export function SecuritySettings({ enabled, isStaff }: { enabled: boolean; isStaff: boolean }) {
	const [action, setAction] = useState<Action>(null)
	const regenerate = useGenerateRecoveryCodesMutation()
	const disable = useDisableTwoFactorMutation()
	const newCodes = regenerate.data?.backupCodes ?? null

	function open(next: Action) {
		regenerate.reset()
		disable.reset()
		setAction(next)
	}

	return (
		<Card className="p-0 shadow-sm">
			<CardContent className="flex flex-col gap-5 p-6 sm:p-8">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h2 className="text-lg font-bold">Two-factor authentication</h2>
						<p className="text-muted-foreground text-sm">
							A code from your phone or email is needed after your password.
						</p>
					</div>
					<span
						className={cn(
							"rounded-full px-2.5 py-0.5 text-xs font-semibold",
							enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
						)}
					>
						{enabled ? "On" : "Off"}
					</span>
				</div>

				{!enabled && (
					<Link
						href="/security/setup-mfa"
						className={cn(buttonVariants(), "h-11 w-full text-base sm:w-auto sm:self-start")}
					>
						Set up two-factor authentication
					</Link>
				)}

				{enabled && isStaff && (
					<FieldDescription>Required for staff accounts. It cannot be turned off.</FieldDescription>
				)}

				{enabled && action === null && (
					<div className="flex flex-col gap-2 sm:flex-row">
						<Button
							type="button"
							variant="outline"
							onClick={() => open("codes")}
							className="hover:cursor-pointer"
						>
							Get new recovery codes
						</Button>
						{!isStaff && (
							<Button
								type="button"
								variant="outline"
								onClick={() => open("disable")}
								className="text-destructive hover:cursor-pointer"
							>
								Turn off
							</Button>
						)}
					</div>
				)}

				{enabled && action === "codes" && !newCodes && (
					<div className="flex flex-col gap-3">
						<p className="text-sm">
							New codes replace the old ones. Codes you saved before will stop working.
						</p>
						<PasswordStep
							label="Make new codes"
							pending={regenerate.isPending}
							error={regenerate.error}
							onConfirm={password => regenerate.mutateAsync({ password })}
							onCancel={() => open(null)}
						/>
					</div>
				)}

				{enabled && action === "codes" && newCodes && (
					<div className="flex flex-col gap-3">
						<p className="text-sm">Save these new recovery codes. They will not be shown again.</p>
						<RecoveryCodes codes={newCodes} />
						<Button
							type="button"
							onClick={() => open(null)}
							className="hover:cursor-pointer sm:self-start"
						>
							Done
						</Button>
					</div>
				)}

				{enabled && action === "disable" && !isStaff && (
					<div className="flex flex-col gap-3">
						<p className="text-sm">Without it, your password alone will open your account.</p>
						<PasswordStep
							label="Turn off"
							danger
							pending={disable.isPending || disable.isSuccess}
							error={disable.error}
							onConfirm={async password => {
								await disable.mutateAsync({ password })
								replaceLocation("/settings/security")
							}}
							onCancel={() => open(null)}
						/>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
