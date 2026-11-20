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
import { PasswordInput } from "@/features/auth/components/password-input"
import { RateLimitBanner } from "@/features/auth/components/rate-limit-banner"
import { ResendVerificationForm } from "@/features/auth/verify-email/components/resend-verification-form"

import { UnverifiedEmailError, useLoginMutation } from "../api/login.hooks"
import { LoginSchema } from "../api/login.schema"

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
	const [showResend, setShowResend] = useState(false)
	const { mutateAsync: login, isPending, isError, error } = useLoginMutation()

	const isUnverified = error instanceof UnverifiedEmailError
	const rateLimit = parseRateLimitError(error)
	const { secondsLeft, isActive } = useRateLimitCountdown(
		rateLimit.isRateLimit ? rateLimit.retryAfter : null
	)

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		validators: {
			onSubmit: LoginSchema,
		},
		onSubmit: async ({ value }) => {
			try {
				await login(value)
			} catch {
				// The mutation stores the error, and the banner reads that state.
				// Catching keeps TanStack Form's handleSubmit() from rejecting,
				// which would be an unhandled rejection on the form's submit handler.
			}
		},
	})

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
								<h1 className="text-2xl font-extrabold tracking-tight">Sign in</h1>
								<p className="text-muted-foreground">
									Welcome back. Sign in to book, pay and get your documents.
								</p>
							</div>

							{isError && isUnverified && (
								<div
									role="alert"
									data-testid="login-unverified-error"
									className="bg-destructive/10 text-destructive dark:bg-destructive/20 flex flex-col items-start gap-1 rounded-lg p-3 text-sm"
								>
									<span>Please verify your email before signing in.</span>
									<Button
										type="button"
										variant="link"
										className="text-destructive h-auto px-0"
										onClick={() => setShowResend(true)}
									>
										Resend verification email
									</Button>
								</div>
							)}

							{isError && !isUnverified && rateLimit.isRateLimit && (
								<RateLimitBanner message={rateLimit.message} secondsLeft={secondsLeft} />
							)}

							{isError && !isUnverified && !rateLimit.isRateLimit && (
								<div
									role="alert"
									data-testid="login-error"
									className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm"
								>
									{error instanceof Error ? error.message : "An unexpected error occurred"}
								</div>
							)}

							{showResend && isUnverified && (
								<ResendVerificationForm prefillEmail={(error as UnverifiedEmailError).email} />
							)}

							<form.Field
								name="email"
								children={field => {
									const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
									return (
										<Field data-invalid={isInvalid}>
											<FieldLabel htmlFor={field.name}>Email</FieldLabel>
											<Input
												id={field.name}
												name={field.name}
												type="email"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={e => field.handleChange(e.target.value)}
												aria-invalid={isInvalid}
												placeholder="m@example.com"
												autoComplete="email"
												required
												disabled={isPending}
											/>
											{isInvalid && <FieldError errors={field.state.meta.errors} />}
										</Field>
									)
								}}
							/>

							<form.Field
								name="password"
								children={field => {
									const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
									return (
										<Field data-invalid={isInvalid}>
											<div className="flex items-center">
												<FieldLabel htmlFor={field.name}>Password</FieldLabel>
												<Link
													href="/forgot-password"
													className={cn(
														buttonVariants({ size: "sm", variant: "link" }),
														"text-primary ml-auto h-auto px-0"
													)}
												>
													Forgot your password?
												</Link>
											</div>
											<PasswordInput
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={e => field.handleChange(e.target.value)}
												aria-invalid={isInvalid}
												required
												autoComplete="current-password"
												disabled={isPending}
											/>
											{isInvalid && <FieldError errors={field.state.meta.errors} />}
										</Field>
									)
								}}
							/>

							<Field>
								<Button
									type="submit"
									disabled={isPending || isActive}
									className="h-11 w-full text-base hover:cursor-pointer"
								>
									{isActive
										? `Try again in ${secondsLeft}s`
										: isPending
											? "Signing in..."
											: "Sign in"}
								</Button>
							</Field>

							<FieldDescription className="text-center">
								Don&apos;t have an account?{" "}
								<Link
									className={cn(buttonVariants({ variant: "link" }), "h-auto px-0 font-semibold")}
									href="/register"
								>
									Create an account
								</Link>
							</FieldDescription>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>
		</div>
	)
}
