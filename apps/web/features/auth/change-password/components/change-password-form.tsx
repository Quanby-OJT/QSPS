"use client"

import { useForm } from "@tanstack/react-form"

import { Button } from "@/core/components/ui/button"
import { Card, CardContent } from "@/core/components/ui/card"
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/core/components/ui/field"
import { useRateLimitCountdown } from "@/core/hooks/use-rate-limit-countdown"
import { replaceLocation } from "@/core/lib/navigate"
import { parseRateLimitError } from "@/core/lib/rate-limit-utils"
import { authClient } from "@/services/better-auth/auth-client"
import { PasswordInput } from "@/features/auth/components/password-input"
import { RateLimitBanner } from "@/features/auth/components/rate-limit-banner"

import { useChangePasswordMutation } from "../api/change-password.hooks"
import { ChangePasswordSchema } from "../api/change-password.schema"

const FIELDS = [
	{ name: "currentPassword", label: "Current password", autoComplete: "current-password" },
	{ name: "newPassword", label: "New password", autoComplete: "new-password" },
	{ name: "confirmPassword", label: "Confirm new password", autoComplete: "new-password" },
] as const

/**
 * AUTH-3: the forced password change. A staff password older than the
 * rotation Policy must be replaced before anything else; the new one must
 * differ from the last five.
 */
export function ChangePasswordForm({ next = "/dashboard" }: { next?: string }) {
	const { mutateAsync: changePassword, isPending, isError, error } = useChangePasswordMutation()
	const rateLimit = parseRateLimitError(error)
	const { secondsLeft, isActive } = useRateLimitCountdown(
		rateLimit.isRateLimit ? rateLimit.retryAfter : null
	)

	const form = useForm({
		defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
		validators: { onSubmit: ChangePasswordSchema },
		onSubmit: async ({ value }) => {
			const done = await changePassword(value).catch(() => null)
			// A full load, so every check in the portal layout runs again.
			if (done) replaceLocation(next)
		},
	})

	async function signOut() {
		await authClient.signOut().catch(() => null)
		replaceLocation("/login")
	}

	return (
		<Card className="p-0 shadow-sm">
			<CardContent className="p-6 sm:p-8">
				<form
					onSubmit={e => {
						e.preventDefault()
						form.handleSubmit()
					}}
				>
					<FieldGroup>
						<div className="flex flex-col gap-1.5">
							<span aria-hidden="true" className="bg-gold mb-1 h-[3px] w-10" />
							<h1 className="text-2xl font-extrabold tracking-tight">Set a new password</h1>
							<p className="text-muted-foreground">
								Your password has reached its maximum age. Choose a new one to continue. It must
								differ from your last 5 passwords.
							</p>
						</div>

						{isError && rateLimit.isRateLimit && (
							<RateLimitBanner message={rateLimit.message} secondsLeft={secondsLeft} />
						)}
						{isError && !rateLimit.isRateLimit && (
							<div
								role="alert"
								className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm"
							>
								{error instanceof Error ? error.message : "An unexpected error occurred"}
							</div>
						)}

						{FIELDS.map(item => (
							<form.Field
								key={item.name}
								name={item.name}
								children={field => {
									const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
									return (
										<Field data-invalid={isInvalid}>
											<FieldLabel htmlFor={field.name}>{item.label}</FieldLabel>
											<PasswordInput
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={e => field.handleChange(e.target.value)}
												aria-invalid={isInvalid}
												autoComplete={item.autoComplete}
												required
												disabled={isPending}
											/>
											{isInvalid && <FieldError errors={field.state.meta.errors} />}
										</Field>
									)
								}}
							/>
						))}

						<Button
							type="submit"
							disabled={isPending || isActive}
							className="h-11 w-full text-base hover:cursor-pointer"
						>
							{isActive
								? `Try again in ${secondsLeft}s`
								: isPending
									? "Saving..."
									: "Save new password"}
						</Button>

						<FieldDescription className="text-center">
							Not now?{" "}
							<button
								type="button"
								onClick={signOut}
								className="text-primary font-semibold underline-offset-4 hover:cursor-pointer hover:underline"
							>
								Sign out
							</button>
						</FieldDescription>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	)
}