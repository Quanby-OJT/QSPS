"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { env } from "@/env"

/**
 * CAPTCHA on the public credential forms (AUTH-3, TOR §II / COA Circular
 * 2021-014): register, sign in, forgot password and reset password.
 *
 * Cloudflare Turnstile. The token goes to the API in the
 * {@link CAPTCHA_HEADER} header, which `@repo/auth` checks before Better Auth
 * runs. With no site key set (local development) no widget is shown and no
 * header is sent; the API then checks nothing either, unless it has a secret.
 */

/** Same name as `CAPTCHA_HEADER` in `@repo/auth/captcha` (not imported: it validates server env). */
export const CAPTCHA_HEADER = "x-captcha-response"

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

interface TurnstileApi {
	render(
		element: HTMLElement,
		options: {
			"sitekey": string
			"theme"?: "auto" | "light" | "dark"
			"size"?: "normal" | "flexible" | "compact"
			"callback"?: (token: string) => void
			"expired-callback"?: () => void
			"error-callback"?: () => void
		}
	): string
	remove(widgetId: string): void
}

declare global {
	interface Window {
		turnstile?: TurnstileApi
	}
}

let loading: Promise<void> | null = null

/** Loads Turnstile's script once per page, however many widgets ask for it. */
function loadTurnstile(): Promise<void> {
	if (typeof window !== "undefined" && window.turnstile) return Promise.resolve()
	loading ??= new Promise<void>((resolve, reject) => {
		const script = document.createElement("script")
		script.src = SCRIPT_SRC
		script.async = true
		script.defer = true
		script.onload = () => resolve()
		script.onerror = () => {
			loading = null
			reject(new Error("Turnstile failed to load"))
		}
		document.head.appendChild(script)
	})
	return loading
}

/** The headers to send with one auth call: the token, or nothing when CAPTCHA is off. */
export function captchaHeaders(token: string | null): Record<string, string> {
	return token ? { [CAPTCHA_HEADER]: token } : {}
}

function TurnstileWidget({
	siteKey,
	onToken,
}: {
	siteKey: string
	onToken: (token: string | null) => void
}) {
	const container = useRef<HTMLDivElement>(null)
	const [failed, setFailed] = useState(false)

	useEffect(() => {
		let widgetId: string | undefined
		let cancelled = false

		loadTurnstile()
			.then(() => {
				if (cancelled || !container.current || !window.turnstile) return
				widgetId = window.turnstile.render(container.current, {
					"sitekey": siteKey,
					"theme": "auto",
					"size": "flexible",
					"callback": token => onToken(token),
					"expired-callback": () => onToken(null),
					"error-callback": () => onToken(null),
				})
			})
			.catch(() => setFailed(true))

		return () => {
			cancelled = true
			if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
		}
	}, [siteKey, onToken])

	return (
		<div className="flex flex-col gap-2">
			<div ref={container} className="min-h-[65px]" />
			{failed ? (
				<p role="alert" className="text-destructive text-sm">
					The security check could not load. Check your connection, then reload the page.
				</p>
			) : null}
		</div>
	)
}

/**
 * CAPTCHA state for one form. Render `widget` above the submit button, keep
 * the button disabled until `ready`, send `headers()` with the auth call, and
 * call `reset()` after every attempt: a Turnstile token works only once.
 */
export function useCaptcha(siteKey: string | undefined = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
	const [token, setToken] = useState<string | null>(null)
	const [generation, setGeneration] = useState(0)
	const enabled = Boolean(siteKey)

	const onToken = useCallback((next: string | null) => setToken(next), [])
	const reset = useCallback(() => {
		setToken(null)
		setGeneration(current => current + 1)
	}, [])

	return {
		enabled,
		ready: !enabled || token !== null,
		token,
		headers: () => captchaHeaders(token),
		reset,
		widget: siteKey ? <TurnstileWidget key={generation} siteKey={siteKey} onToken={onToken} /> : null,
	}
}