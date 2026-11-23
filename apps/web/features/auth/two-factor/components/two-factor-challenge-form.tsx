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
import { Input } from "@/core/components/ui/input"
import { useRateLimitCountdown } from "@/core/hooks/use-rate-limit-countdown"
import { parseRateLimitError } from "@/core/lib/rate-limit-utils"
import { cn } from "@/core/lib/utils"
import { RateLimitBanner } from "@/features/auth/components/rate-limit-banner"

import {
	ChallengeExpiredError,
	useSendEmailCodeMutation,
	useVerifyTwoFactorMutation,
	type TwoFactorMethod,
} from "../api/two-factor.hooks"
import { OneTimeCodeSchema, RecoveryCodeSchema } from "../api/two-factor.schema"

const METHODS: ReadonlyArray<{ value: TwoFactorMethod; label: string; hint: string }> = [
	{
		value: "totp",
		label: "Authenticator",
		hint: "Open your authenticator app and enter the 6-digit code shown for QSPS.",
	},
	{
		value: "otp",
		label: "Email / SMS code",
		hint: "We will send a 6-digit code to your configured email or verified mobile number. It expires after 5 minutes.",
	},
	{
		value: "backup_code",
		label: "Recovery code",
		hint: "Enter one of the recovery codes you saved when you set this up. Each one works once.",
	},
]

/**
 * Second sign-in step (AUTH-2). The password was accepted; a code from the
 * authenticator app, the sign-in email or a saved recovery code finishes it.
 */
export function TwoFactorChallengeForm({ className, ...props }: React.ComponentProps<"div">) {
	const [method, setMethod] = useState<TwoFactorMethod>("totp")
	const verify = useVerifyTwoFactorMutation()
	const sendCode = useSendEmailCodeMutation()

	const error = verify.error ?? sendCode.error
	const isExpired = error instanceof ChallengeExpiredError
	const rateLimit = parseRateLimitError(error)
	const { secondsLeft, isActive } = useRateLimitCountdown(
		rateLimit.isRateLimit ? rateLimit.retryAfter : null
	)
	// Stay disabled after success while the dashboard loads.
	const isBusy = verify.isPending || verify.isSuccess
	const hint = METHODS.find(entry => entry.value === method)?.hint
	const isRecovery = method === "backup_code"

	const form = useForm({
		defaultValues: { code: "" },
		onSubmit: async ({ value }) => {
			// The mutation stores the error, and the banner below reads that state.
			await verify.mutateAsync({ method, code: value.code.trim() }).catch(() => null)
		},
	})

	function choose(next: TwoFactorMethod) {
		setMethod(next)
		form.reset()
		verify.reset()
		sendCode.reset()
	}

	return (
		<div className={cn("flex flex-col gap-6", className)} {...props}>
			<Card className="p-0 shadow-sm">
				<CardContent className="p-0">
					<form
						className="p-6 sm:p-8"
						onSubmit={e => {
							e.preventDefault()
							form.handleSubmit()
						}}
					>
						<FieldGroup>
							<div className="flex flex-col gap-1.5">
								<span aria-hidden="true" className="bg-gold mb-1 h-[3px] w-10" />
								<h1 className="text-2xl font-extrabold tracking-tight">Confirm it&apos;s you</h1>
								<p className="text-muted-foreground">
									Your account uses two-step sign-in. Enter a code to finish signing in.
								</p>
							</div>

							<div
								role="radiogroup"
								aria-label="Verification method"
								className="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1"
							>
								{METHODS.map(entry => {
									const selected = entry.value === method
									return (
										<button
											key={entry.value}
											type="button"
											role="radio"
											aria-checked={selected}
											disabled={isBusy}
											onClick={() => choose(entry.value)}
											className={cn(
												"min-h-10 rounded-md px-2 text-xs font-semibold leading-tight transition-colors hover:cursor-pointer sm:text-sm",
												selected
													? "bg-background text-foreground shadow-sm"
													: "text-muted-foreground hover:text-foreground"
											)}
										>
											{entry.label}
										</button>
									)
								})}
							</div>

							{isExpired && (
								<div
									role="alert"
									data-testid="two-factor-expired"
									className="bg-destructive/10 text-destructive dark:bg-destructive/20 flex flex-col items-start gap-1 rounded-lg p-3 text-sm"
								>
									<span>{error.message}</span>
									<Link
										replace
										href="/login"
										className={cn(
											buttonVariants({ variant: "link" }),
											"text-destructive h-auto px-0"
										)}
									>
										Sign in again
									</Link>
								</div>
							)}

							{!isExpired && rateLimit.isRateLimit && (
								<RateLimitBanner message={rateLimit.message} secondsLeft={secondsLeft} />
							)}

							{error && !isExpired && !rateLimit.isRateLimit && (
								<div
									role="alert"
									data-testid="two-factor-error"
									className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm"
								>
									{error.message || "An unexpected error occurred"}
								</div>
							)}

							{method === "otp" && (
								<Field>
									<Button
										type="button"
										variant="outline"
										disabled={sendCode.isPending || isBusy || isActive}
										onClick={() => sendCode.mutate()}
										className="w-full hover:cursor-pointer"
									>
										{sendCode.isPending
											? "Sending..."
											: sendCode.isSuccess
												? "Send a new code"
												: "Send me a code"}
									</Button>
									{sendCode.isSuccess && (
										<FieldDescription className="text-success" role="status">
											Code sent. Check your email or text messages.
										</FieldDescription>
									)}
								</Field>
							)}

							<form.Field
								name="code"
								validators={{ onSubmit: isRecovery ? RecoveryCodeSchema : OneTimeCodeSchema }}
								children={field => {
									const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
									return (
										<Field data-invalid={isInvalid}>
											<FieldLabel htmlFor={field.name}>
												{isRecovery ? "Recovery code" : "6-digit code"}
											</FieldLabel>
											<Input
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={e => field.handleChange(e.target.value)}
												aria-invalid={isInvalid}
												inputMode={isRecovery ? "text" : "numeric"}
												autoComplete="one-time-code"
												maxLength={isRecovery ? 32 : 6}
												placeholder={isRecovery ? "xxxxx-xxxxx" : "123456"}
												className="font-mono tracking-widest"
												autoFocus
												required
												disabled={isBusy}
											/>
											{hint && <FieldDescription>{hint}</FieldDescription>}
											{isInvalid && <FieldError errors={field.state.meta.errors} />}
										</Field>
									)
								}}
							/>

							<Field>
								<Button
									type="submit"
									disabled={isBusy || isActive || isExpired}
									className="h-11 w-full text-base hover:cursor-pointer"
								>
									{isActive
										? `Try again in ${secondsLeft}s`
										: isBusy
											? "Verifying..."
											: "Verify and sign in"}
								</Button>
							</Field>

							<FieldDescription className="text-center">
								Not your account?{" "}
								<Link
									replace
									href="/login"
									className={cn(buttonVariants({ variant: "link" }), "h-auto px-0 font-semibold")}
								>
									Sign in with a different one
								</Link>
							</FieldDescription>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>
		</div>
	)
}
