"use client"

import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { QRCodeSVG } from "qrcode.react"

import { Button } from "@/core/components/ui/button"
import { Card, CardContent } from "@/core/components/ui/card"
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/core/components/ui/field"
import { Input } from "@/core/components/ui/input"
import { replaceLocation } from "@/core/lib/navigate"
import { cn } from "@/core/lib/utils"
import { authClient } from "@/services/better-auth/auth-client"
import { PasswordInput } from "@/features/auth/components/password-input"

import {
	useConfirmAuthenticatorMutation,
	useEnableTwoFactorMutation,
} from "../api/two-factor.hooks"
import { OneTimeCodeSchema, PasswordConfirmSchema } from "../api/two-factor.schema"
import { RecoveryCodes } from "./recovery-codes"

type Step =
	| { name: "password" }
	| { name: "scan"; totpURI: string; backupCodes: string[] }
	| { name: "codes"; backupCodes: string[] }

const STEPS = ["Confirm password", "Scan and verify", "Save recovery codes"] as const
const STEP_INDEX: Record<Step["name"], number> = { password: 0, scan: 1, codes: 2 }

/** The key inside the QR link, for people who type it in by hand. */
function secretFrom(totpURI: string): string | null {
	try {
		return new URL(totpURI).searchParams.get("secret")
	} catch {
		return null
	}
}

function ErrorBanner({ error }: { error: Error | null }) {
	if (!error) return null
	return (
		<div
			role="alert"
			className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm"
		>
			{error.message || "An unexpected error occurred"}
		</div>
	)
}

/**
 * Two-factor enrolment (AUTH-2): password, then the authenticator QR code and
 * its first code, then the recovery codes. Required for staff before any
 * other screen; optional for clients, who reach it from security settings.
 */
export function MfaSetupFlow({
	required,
	next = "/dashboard",
}: {
	required: boolean
	next?: string
}) {
	const [step, setStep] = useState<Step>({ name: "password" })
	const [saved, setSaved] = useState(false)
	const enable = useEnableTwoFactorMutation()
	const confirm = useConfirmAuthenticatorMutation()
	const current = STEP_INDEX[step.name]

	const passwordForm = useForm({
		defaultValues: { password: "" },
		onSubmit: async ({ value }) => {
			const started = await enable.mutateAsync({ password: value.password }).catch(() => null)
			// The server answers with the QR link only when the authenticator app is set up.
			if (started && "totpURI" in started) {
				setStep({ name: "scan", totpURI: started.totpURI, backupCodes: started.backupCodes })
			}
		},
	})

	const codeForm = useForm({
		defaultValues: { code: "" },
		onSubmit: async ({ value }) => {
			if (step.name !== "scan") return
			const confirmed = await confirm.mutateAsync({ code: value.code.trim() }).catch(() => null)
			if (confirmed) {
				setStep({ name: "codes", backupCodes: step.backupCodes })
			}
		},
	})

	async function signOut() {
		await authClient.signOut().catch(() => null)
		replaceLocation("/login")
	}

	return (
		<Card className="p-0 shadow-sm">
			<CardContent className="p-6 sm:p-8">
				<FieldGroup>
					<div className="flex flex-col gap-1.5">
						<span aria-hidden="true" className="bg-gold mb-1 h-[3px] w-10" />
						<h1 className="text-2xl font-extrabold tracking-tight">
							Set up two-factor authentication
						</h1>
						<p className="text-muted-foreground">
							{required
								? "Staff accounts must use two-step sign-in. It keeps client records and payments safe even if your password is exposed."
								: "Add a second step to your sign-in, so a stolen password is not enough to open your account."}
						</p>
					</div>

					<ol aria-label="Progress" className="grid grid-cols-3 gap-2">
						{STEPS.map((label, index) => (
							<li
								key={label}
								aria-current={index === current ? "step" : undefined}
								className="flex flex-col items-center gap-1.5 text-center"
							>
								<span
									className={cn(
										"flex size-7 items-center justify-center rounded-full text-xs font-bold",
										index < current && "bg-success text-white",
										index === current && "bg-primary text-primary-foreground",
										index > current && "bg-muted text-muted-foreground"
									)}
								>
									{index + 1}
								</span>
								<span
									className={cn(
										"text-[11px] leading-tight sm:text-xs",
										index === current ? "text-foreground font-semibold" : "text-muted-foreground"
									)}
								>
									{label}
								</span>
							</li>
						))}
					</ol>

					{step.name === "password" && (
						<form
							onSubmit={e => {
								e.preventDefault()
								passwordForm.handleSubmit()
							}}
						>
							<FieldGroup>
								<ErrorBanner error={enable.error} />
								<passwordForm.Field
									name="password"
									validators={{ onSubmit: PasswordConfirmSchema }}
									children={field => {
										const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
										return (
											<Field data-invalid={isInvalid}>
												<FieldLabel htmlFor={field.name}>Your password</FieldLabel>
												<PasswordInput
													id={field.name}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={e => field.handleChange(e.target.value)}
													aria-invalid={isInvalid}
													autoComplete="current-password"
													required
													disabled={enable.isPending}
												/>
												<FieldDescription>
													We ask again before changing sign-in security.
												</FieldDescription>
												{isInvalid && <FieldError errors={field.state.meta.errors} />}
											</Field>
										)
									}}
								/>
								<Button
									type="submit"
									disabled={enable.isPending}
									className="h-11 w-full text-base hover:cursor-pointer"
								>
									{enable.isPending ? "Checking..." : "Continue"}
								</Button>
							</FieldGroup>
						</form>
					)}

					{step.name === "scan" && (
						<form
							onSubmit={e => {
								e.preventDefault()
								codeForm.handleSubmit()
							}}
						>
							<FieldGroup>
								<p className="text-sm">
									Scan this with an authenticator app such as Google Authenticator, Microsoft
									Authenticator or Authy, then enter the code it shows.
								</p>
								<div className="flex justify-center">
									<div className="rounded-lg border bg-white p-3">
										<QRCodeSVG
											value={step.totpURI}
											size={176}
											title="QR code for your authenticator app"
										/>
									</div>
								</div>
								{secretFrom(step.totpURI) && (
									<p className="text-muted-foreground text-center text-xs">
										Can&apos;t scan? Enter this key instead:
										<span className="text-foreground mt-1 block font-mono text-sm tracking-wider break-all select-all">
											{secretFrom(step.totpURI)}
										</span>
									</p>
								)}
								<ErrorBanner error={confirm.error} />
								<codeForm.Field
									name="code"
									validators={{ onSubmit: OneTimeCodeSchema }}
									children={field => {
										const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
										return (
											<Field data-invalid={isInvalid}>
												<FieldLabel htmlFor={field.name}>6-digit code</FieldLabel>
												<Input
													id={field.name}
													name={field.name}
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={e => field.handleChange(e.target.value)}
													aria-invalid={isInvalid}
													inputMode="numeric"
													autoComplete="one-time-code"
													maxLength={6}
													placeholder="123456"
													className="font-mono tracking-widest"
													required
													disabled={confirm.isPending}
												/>
												{isInvalid && <FieldError errors={field.state.meta.errors} />}
											</Field>
										)
									}}
								/>
								<Button
									type="submit"
									disabled={confirm.isPending}
									className="h-11 w-full text-base hover:cursor-pointer"
								>
									{confirm.isPending ? "Verifying..." : "Verify code"}
								</Button>
							</FieldGroup>
						</form>
					)}

					{step.name === "codes" && (
						<div className="flex flex-col gap-4">
							<div
								className="bg-success/10 text-success rounded-lg p-3 text-sm font-semibold"
								role="status"
							>
								Two-factor authentication is on.
							</div>
							<p className="text-sm">
								Save these recovery codes. If you lose your phone, each one lets you sign in once.
								They will not be shown again.
							</p>
							<RecoveryCodes codes={step.backupCodes} />
							<label className="flex items-start gap-2 text-sm">
								<input
									type="checkbox"
									checked={saved}
									onChange={e => setSaved(e.target.checked)}
									className="accent-primary mt-0.5 size-4"
								/>
								I have saved my recovery codes somewhere safe.
							</label>
							<Button
								type="button"
								disabled={!saved}
								onClick={() => replaceLocation(next)}
								className="h-11 w-full text-base hover:cursor-pointer"
							>
								Finish
							</Button>
						</div>
					)}

					{required && step.name !== "codes" && (
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
					)}
				</FieldGroup>
			</CardContent>
		</Card>
	)
}
