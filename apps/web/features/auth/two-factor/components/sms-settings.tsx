"use client"

import { useEffect, useState } from "react"

import { Button } from "@/core/components/ui/button"
import { Card, CardContent } from "@/core/components/ui/card"
import { Input } from "@/core/components/ui/input"
import { env } from "@/env"

type Settings = {
	mobile: string | null
	mobileVerifiedAt: string | null
	smsNotificationsEnabled: boolean
	mfaOtpChannel: "email" | "sms"
	twoFactorEnabled: boolean
}
const endpoint = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}/me/sms`

async function api<T>(path = "", method = "GET", body?: unknown): Promise<T> {
	const response = await fetch(`${endpoint}${path}`, {
		method,
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	})
	const result = await response.json()
	if (!response.ok)
		throw new Error(
			typeof result.message === "string" ? result.message : "SMS settings request failed"
		)
	return result as T
}

export function SmsSettings() {
	const [settings, setSettings] = useState<Settings | null>(null)
	const [mobile, setMobile] = useState("")
	const [code, setCode] = useState("")
	const [sent, setSent] = useState(false)
	const [enabled, setEnabled] = useState(false)
	const [channel, setChannel] = useState<"email" | "sms">("email")
	const [password, setPassword] = useState("")
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState("")
	const [error, setError] = useState("")
	function load(value: Settings) {
		setSettings(value)
		setMobile(value.mobile ?? "")
		setEnabled(value.smsNotificationsEnabled)
		setChannel(value.mfaOtpChannel)
	}
	useEffect(() => {
		api<Settings>()
			.then(load)
			.catch(err => setError(err instanceof Error ? err.message : "Unable to load SMS settings"))
	}, [])
	async function run(action: () => Promise<void>) {
		setBusy(true)
		setError("")
		setMessage("")
		try {
			await action()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Request failed")
		} finally {
			setBusy(false)
		}
	}
	return (
		<Card>
			<CardContent className="flex flex-col gap-4 p-6">
				<h2 className="text-xl font-semibold">Mobile and SMS settings</h2>
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				{message && (
					<p role="status" className="text-success text-sm">
						{message}
					</p>
				)}
				{settings && (
					<>
						<label htmlFor="sms-mobile">
							Mobile number {settings.mobileVerifiedAt ? "(verified)" : "(not verified)"}
						</label>
						<Input
							id="sms-mobile"
							type="tel"
							value={mobile}
							onChange={event => {
								setMobile(event.target.value)
								setSent(false)
							}}
							placeholder="+639123456789"
							disabled={busy}
						/>
						<Button
							type="button"
							disabled={busy || !mobile.trim()}
							onClick={() =>
								void run(async () => {
									await api("/request-code", "POST", { mobile })
									setSent(true)
									setCode("")
									setMessage("Verification code sent.")
								})
							}
						>
							Send verification code
						</Button>
						{sent && (
							<>
								<label htmlFor="sms-verify">6-digit code</label>
								<Input
									id="sms-verify"
									inputMode="numeric"
									autoComplete="one-time-code"
									maxLength={6}
									value={code}
									onChange={event => setCode(event.target.value)}
								/>
								<Button
									disabled={busy || !/^\d{6}$/.test(code)}
									onClick={() =>
										void run(async () => {
											load(await api<Settings>("/verify-code", "POST", { code }))
											setSent(false)
											setCode("")
											setMessage("Mobile number verified.")
										})
									}
								>
									Verify mobile number
								</Button>
							</>
						)}
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={enabled}
								disabled={!settings.mobileVerifiedAt || busy}
								onChange={event => setEnabled(event.target.checked)}
							/>{" "}
							Receive booking and payment SMS notifications
						</label>
						<label htmlFor="sms-mfa-channel">Sign-in one-time code delivery</label>
						<select
							id="sms-mfa-channel"
							className="border-input bg-background rounded-lg border p-2"
							value={channel}
							onChange={event => setChannel(event.target.value === "sms" ? "sms" : "email")}
							disabled={busy}
						>
							<option value="email">Email</option>
							<option
								value="sms"
								disabled={!settings.mobileVerifiedAt || !settings.twoFactorEnabled}
							>
								SMS
							</option>
						</select>
						{!settings.twoFactorEnabled && (
							<p className="text-muted-foreground text-sm">
								Enable two-factor authentication in Security settings before choosing SMS.
							</p>
						)}
						{channel !== settings.mfaOtpChannel && (
							<>
								<label htmlFor="sms-password">Confirm your password</label>
								<Input
									id="sms-password"
									type="password"
									autoComplete="current-password"
									value={password}
									onChange={event => setPassword(event.target.value)}
								/>
							</>
						)}
						<Button
							disabled={busy || (channel !== settings.mfaOtpChannel && !password)}
							onClick={() =>
								void run(async () => {
									try {
										load(
											await api<Settings>("/preferences", "PUT", {
												smsNotificationsEnabled: enabled,
												mfaOtpChannel: channel,
												...(password ? { password } : {}),
											})
										)
										setMessage("SMS preferences saved.")
									} finally {
										setPassword("")
									}
								})
							}
						>
							Save preferences
						</Button>
					</>
				)}
			</CardContent>
		</Card>
	)
}
