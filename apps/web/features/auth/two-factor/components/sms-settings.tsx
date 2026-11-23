"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import type { SmsSettings as Settings, SmsChannel } from "@repo/contracts"

import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import { Card, CardContent } from "@/core/components/ui/card"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/core/components/ui/field"
import { Input } from "@/core/components/ui/input"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { cn } from "@/core/lib/utils"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { PasswordInput } from "@/features/auth/components/password-input"

import {
	useRequestSmsCodeMutation,
	useSmsSettingsQuery,
	useUpdateSmsPreferencesMutation,
	useVerifySmsCodeMutation,
} from "../api/sms.hooks"

const CHANNELS: ReadonlyArray<{ value: SmsChannel; label: string }> = [
	{ value: "email", label: "Email" },
	{ value: "sms", label: "SMS" },
]

/** Longest input we accept, e.g. "+63 917-123-4567" with separators. */
const MOBILE_MAX_LENGTH = 16

/**
 * Keeps only what a phone number can contain while typing: digits, spaces,
 * dashes, and one "+" at the very start.
 */
function cleanMobileInput(value: string): string {
	const kept = value.replace(/[^\d+\s-]/g, "")
	const leadingPlus = kept.startsWith("+")
	return (leadingPlus ? "+" : "") + kept.replace(/\+/g, "")
}

/**
 * Turns 09171234567, 9171234567, 639171234567 or +639171234567 (with or
 * without spaces and dashes) into +639171234567. Returns null when the input
 * is not a Philippine mobile number. The server checks again.
 */
function normalizePhMobile(value: string): string | null {
	const compact = value.replace(/[\s-]/g, "")
	let digits: string
	if (/^\+639\d{9}$/.test(compact)) digits = compact.slice(3)
	else if (/^639\d{9}$/.test(compact)) digits = compact.slice(2)
	else if (/^09\d{9}$/.test(compact)) digits = compact.slice(1)
	else if (/^9\d{9}$/.test(compact)) digits = compact
	else return null
	return `+63${digits}`
}

function ErrorNote({ error }: { error: Error | null }) {
	if (!error) return null
	return (
		<div
			role="alert"
			className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm"
		>
			{error.message || "Something went wrong. Please try again."}
		</div>
	)
}

/** Remounts the form whenever the saved settings change, so it starts from them. */
function settingsKey(settings: Settings): string {
	return [
		settings.mobile ?? "",
		String(settings.mobileVerifiedAt ?? ""),
		settings.smsNotificationsEnabled,
		settings.mfaOtpChannel,
		settings.twoFactorEnabled,
	].join("|")
}

/**
 * NTF-2: verify a mobile number, turn booking SMS on or off, and choose where
 * sign-in codes go. Every change is checked again on the server.
 */
export function SmsSettings() {
	const query = useSmsSettingsQuery()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	// The server and the first client render both show the placeholder.
	const loading = !hydrated || isQueryLoading(query)

	return (
		<Card className="p-0 shadow-sm">
			<CardContent className="flex flex-col gap-5 p-6 sm:p-8">
				<div className="flex flex-col gap-1">
					<h2 className="text-lg font-bold">Mobile number and text messages</h2>
					<p className="text-muted-foreground text-sm">
						Get booking updates by SMS, and receive sign-in codes on your phone.
					</p>
				</div>

				{loading ? (
					<div className="flex flex-col gap-3" role="status" aria-label="Loading SMS settings">
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-24 w-full" />
					</div>
				) : query.isError ? (
					<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
						<p className="text-sm font-medium">Could not load your SMS settings.</p>
						<p className="text-muted-foreground mt-1 text-sm">{query.error.message}</p>
						<Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
							Retry
						</Button>
					</div>
				) : query.data ? (
					<SmsSettingsForm key={settingsKey(query.data)} settings={query.data} />
				) : null}
			</CardContent>
		</Card>
	)
}

function SmsSettingsForm({ settings }: { settings: Settings }) {
	const requestCode = useRequestSmsCodeMutation()
	const verifyCode = useVerifySmsCodeMutation()
	const savePreferences = useUpdateSmsPreferencesMutation()

	const [mobile, setMobile] = useState(settings.mobile ?? "")
	const [mobileTouched, setMobileTouched] = useState(false)
	const [code, setCode] = useState("")
	const [codeSent, setCodeSent] = useState(false)
	const [notifications, setNotifications] = useState(settings.smsNotificationsEnabled)
	const [channel, setChannel] = useState<SmsChannel>(settings.mfaOtpChannel)
	const [password, setPassword] = useState("")

	// The saved number's state: booking SMS and sign-in codes keep using it
	// until a new number is verified.
	const savedVerified = settings.mobileVerifiedAt !== null
	const normalizedMobile = normalizePhMobile(mobile)
	const sameNumber = normalizedMobile !== null && normalizedMobile === settings.mobile
	// The badge describes the number in the field, not only the saved one.
	const showVerified = savedVerified && sameNumber
	const mobileInvalid = mobile.trim() !== "" && normalizedMobile === null
	const showMobileError = mobileTouched && mobileInvalid

	const numberLocked = settings.mfaOtpChannel === "sms"
	const channelChanged = channel !== settings.mfaOtpChannel
	const preferencesChanged = channelChanged || notifications !== settings.smsNotificationsEnabled
	const smsChannelAllowed = savedVerified && settings.twoFactorEnabled
	const busy = requestCode.isPending || verifyCode.isPending || savePreferences.isPending

	async function sendCode() {
		if (!normalizedMobile) {
			setMobileTouched(true)
			return
		}
		verifyCode.reset()
		try {
			await requestCode.mutateAsync({ mobile: normalizedMobile })
			setCodeSent(true)
			setCode("")
			toast.success("Code sent. Check your text messages.")
		} catch {
			// The error is shown under the number.
		}
	}

	async function confirmCode(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		try {
			await verifyCode.mutateAsync({ code })
			toast.success("Mobile number verified")
		} catch {
			// The error is shown under the code.
		}
	}

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		try {
			await savePreferences.mutateAsync({
				smsNotificationsEnabled: notifications,
				mfaOtpChannel: channel,
				...(channelChanged ? { password } : {}),
			})
			toast.success("SMS settings saved")
		} catch {
			setPassword("")
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<Field data-invalid={showMobileError || undefined}>
				<div className="flex flex-wrap items-center gap-2">
					<FieldLabel htmlFor="sms-mobile">Mobile number</FieldLabel>
					<Badge variant={showVerified ? "default" : "secondary"}>
						{showVerified ? "Verified" : "Not verified"}
					</Badge>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row">
					<Input
						id="sms-mobile"
						type="tel"
						inputMode="tel"
						autoComplete="tel"
						placeholder="09171234567"
						maxLength={MOBILE_MAX_LENGTH}
						value={mobile}
						aria-invalid={showMobileError || undefined}
						aria-describedby={showMobileError ? "sms-mobile-error" : "sms-mobile-help"}
						onChange={event => {
							setMobile(cleanMobileInput(event.target.value))
							setCodeSent(false)
							requestCode.reset()
						}}
						onBlur={() => setMobileTouched(true)}
						disabled={busy || numberLocked}
						className="sm:flex-1"
					/>
					<Button
						type="button"
						variant="outline"
						className="w-full hover:cursor-pointer sm:w-auto"
						disabled={busy || numberLocked || normalizedMobile === null || showVerified}
						onClick={() => void sendCode()}
					>
						{requestCode.isPending ? "Sending..." : codeSent ? "Send a new code" : "Send code"}
					</Button>
				</div>
				{showMobileError ? (
					<FieldError id="sms-mobile-error">
						Enter a Philippine mobile number, like 09171234567 or +639171234567.
					</FieldError>
				) : (
					<FieldDescription id="sms-mobile-help">
						{numberLocked
							? "Switch sign-in codes to email before changing this number."
							: savedVerified && !sameNumber && settings.mobile
								? `Texts still go to ${settings.mobile} until you verify the new number.`
								: "A Philippine mobile number, like 09171234567. We text a 6-digit code to confirm it."}
					</FieldDescription>
				)}
				<ErrorNote error={requestCode.error} />
			</Field>

			{codeSent && (
				<form
					onSubmit={event => void confirmCode(event)}
					className="bg-muted/50 flex flex-col gap-3 rounded-lg border p-4"
				>
					<Field>
						<FieldLabel htmlFor="sms-code">6-digit code</FieldLabel>
						<Input
							id="sms-code"
							inputMode="numeric"
							autoComplete="one-time-code"
							maxLength={6}
							placeholder="123456"
							className="font-mono tracking-widest"
							value={code}
							onChange={event => setCode(event.target.value.replace(/\D/g, ""))}
							disabled={busy}
						/>
						<FieldDescription>The code expires after 5 minutes.</FieldDescription>
					</Field>
					<ErrorNote error={verifyCode.error} />
					<Button
						type="submit"
						className="w-full hover:cursor-pointer sm:w-auto sm:self-start"
						disabled={busy || !/^\d{6}$/.test(code)}
					>
						{verifyCode.isPending ? "Verifying..." : "Verify number"}
					</Button>
				</form>
			)}

			<form onSubmit={event => void save(event)} className="flex flex-col gap-4 border-t pt-5">
				<label className="flex items-start gap-3">
					<input
						type="checkbox"
						className="accent-primary mt-1 size-4"
						checked={notifications}
						disabled={busy || !savedVerified}
						onChange={event => setNotifications(event.target.checked)}
					/>
					<span className="flex flex-col gap-0.5">
						<span className="text-sm font-semibold">Text me about my bookings</span>
						<span className="text-muted-foreground text-sm">
							{savedVerified
								? "Booking confirmed, payment received and booking cancelled, with your reference number."
								: "Verify your mobile number first."}
						</span>
					</span>
				</label>

				<div className="flex flex-col gap-2">
					<span id="sms-channel-label" className="text-sm font-semibold">
						Send sign-in codes by
					</span>
					<div
						role="radiogroup"
						aria-labelledby="sms-channel-label"
						className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1 sm:max-w-xs"
					>
						{CHANNELS.map(entry => {
							const selected = entry.value === channel
							return (
								<button
									key={entry.value}
									type="button"
									role="radio"
									aria-checked={selected}
									disabled={busy || (entry.value === "sms" && !smsChannelAllowed)}
									onClick={() => setChannel(entry.value)}
									className={cn(
										"min-h-10 rounded-md px-2 text-sm font-semibold transition-colors hover:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
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
					{!settings.twoFactorEnabled ? (
						<FieldDescription>
							Turn on two-factor authentication in{" "}
							<Link
								href="/settings/security"
								className={cn(buttonVariants({ variant: "link" }), "h-auto px-0")}
							>
								Security
							</Link>{" "}
							to get codes by SMS.
						</FieldDescription>
					) : !savedVerified ? (
						<FieldDescription>Verify your mobile number to get codes by SMS.</FieldDescription>
					) : null}
				</div>

				{channelChanged && (
					<Field>
						<FieldLabel htmlFor="sms-password">Confirm your password</FieldLabel>
						<PasswordInput
							id="sms-password"
							name="password"
							value={password}
							onChange={event => setPassword(event.target.value)}
							autoComplete="current-password"
							disabled={busy}
						/>
					</Field>
				)}

				<ErrorNote error={savePreferences.error} />
				<Button
					type="submit"
					className="h-11 w-full text-base hover:cursor-pointer sm:w-auto sm:self-start"
					disabled={busy || !preferencesChanged || (channelChanged && !password)}
				>
					{savePreferences.isPending ? "Saving..." : "Save settings"}
				</Button>
			</form>
		</div>
	)
}
