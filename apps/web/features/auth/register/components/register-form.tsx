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
import { useCaptcha } from "@/features/auth/captcha/captcha"
import { RateLimitBanner } from "@/features/auth/components/rate-limit-banner"

import { useRegisterMutation } from "../api/register.hooks"
import { RegisterSchema } from "../api/register.schema"
import { CheckYourEmailView } from "./check-your-email-view"

export function RegisterForm({ className, ...props }: React.ComponentProps<"div">) {
	const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
	const { mutateAsync: register, isPending, isError, error } = useRegisterMutation()
	const captcha = useCaptcha()
	const rateLimit = parseRateLimitError(error)
	const { secondsLeft, isActive } = useRateLimitCountdown(
		rateLimit.isRateLimit ? rateLimit.retryAfter : null
	)

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
			name: "",
			privacyAccepted: false,
		},
		validators: {
			onSubmit: RegisterSchema,
		},
		onSubmit: async ({ value }) => {
			// The mutation stores the error, and the banner reads that state.
			const result = await register({ ...value, captchaToken: captcha.token }).catch(() => null)
			// AUTH-3: a CAPTCHA token works once.
			if (!result) captcha.reset()
			if (result?.requiresVerification) {
				setVerificationEmail(result.email)
			}
		},
	})

	if (verificationEmail) {
		return <CheckYourEmailView email={verificationEmail} />
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
								<h1 className="text-2xl font-extrabold tracking-tight">Create an account</h1>
								<p className="text-muted-foreground">
									One account for all your BOQ bookings, receipts and certificates.
								</p>
							</div>

							{isError && rateLimit.isRateLimit && (
								<RateLimitBanner message={rateLimit.message} secondsLeft={secondsLeft} />
							)}

							{isError && !rateLimit.isRateLimit && (
								<div className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm">
									{error instanceof Error ? error.message : "An unexpected error occurred"}
								</div>
							)}

							<form.Field
								name="name"
								children={field => {
									const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
									return (
										<Field data-invalid={isInvalid}>
											<FieldLabel htmlFor={field.name}>Name</FieldLabel>
											<Input
												id={field.name}
												name={field.name}
												type="text"
												value={field.state.value || ""}
												onBlur={field.handleBlur}
												onChange={e => field.handleChange(e.target.value)}
												aria-invalid={isInvalid}
												placeholder="Juan Dela Cruz"
												autoComplete="name"
												disabled={isPending}
											/>
											{isInvalid && <FieldError errors={field.state.meta.errors} />}
										</Field>
									)
								}}
							/>

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
												placeholder="you@example.com"
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
											<FieldLabel htmlFor={field.name}>Password</FieldLabel>
											<PasswordInput
												id={field.name}
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={e => field.handleChange(e.target.value)}
												aria-invalid={isInvalid}
												required
												autoComplete="new-password"
												disabled={isPending}
											/>
											{isInvalid && <FieldError errors={field.state.meta.errors} />}
										</Field>
									)
								}}
							/>

							<form.Field
								name="privacyAccepted"
								children={field => {
									const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
									return (
										<Field data-invalid={isInvalid}>
											<div className="flex items-start gap-3">
												<input
													id={field.name}
													name={field.name}
													type="checkbox"
													className="accent-primary mt-1 size-4 shrink-0"
													checked={field.state.value}
													onBlur={field.handleBlur}
													onChange={e => field.handleChange(e.target.checked)}
													aria-invalid={isInvalid}
													aria-describedby="privacy-notice"
													disabled={isPending}
												/>
												<FieldLabel htmlFor={field.name} className="leading-snug font-normal">
													I have read and accept the privacy notice below.
												</FieldLabel>
											</div>
											<FieldDescription
												id="privacy-notice"
												className="bg-muted rounded-lg p-3 text-xs leading-relaxed"
											>
												The Bureau of Quarantine collects your name, email, mobile number, birth
												date, nationality, and gender to create your account, schedule and process
												the services you book, and issue your documents, as allowed by the Data
												Privacy Act of 2012 (RA 10173). Your data is kept only as long as BOQ&apos;s
												retention policy requires and is used only for the services you request.
											</FieldDescription>
											{isInvalid && <FieldError errors={field.state.meta.errors} />}
										</Field>
									)
								}}
							/>

							<Field>
								{captcha.widget}
								<Button
									type="submit"
									disabled={isPending || isActive || !captcha.ready}
									className="h-11 w-full text-base hover:cursor-pointer"
								>
									{isActive
										? `Try again in ${secondsLeft}s`
										: isPending
											? "Creating account..."
											: "Create account"}
								</Button>
							</Field>

							<FieldDescription className="text-center">
								Already have an account?{" "}
								<Link
									className={cn(buttonVariants({ variant: "link" }), "h-auto px-0 font-semibold")}
									replace
									href="/login"
								>
									Sign in
								</Link>
							</FieldDescription>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>
		</div>
	)
}