/**
 * CAPTCHA check for the public credential forms (AUTH-3, TOR §II / COA
 * Circular 2021-014).
 *
 * Sign-up, sign-in, the reset request and the reset itself must carry a
 * CAPTCHA token in the {@link CAPTCHA_HEADER} header. The token is checked
 * before Better Auth touches the database, so a scripted attempt never reaches
 * the password check or the mailer.
 *
 * The provider sits behind {@link CaptchaVerifier} so it can be swapped
 * (reCAPTCHA, hCaptcha) without touching the auth flow. Cloudflare Turnstile is
 * the default.
 *
 * Kept free of `createEnv()` so it can be tested without auth configuration.
 */

/** Header the web forms send the CAPTCHA token in. */
export const CAPTCHA_HEADER = "x-captcha-response"

/** Better Auth paths that need a CAPTCHA token (base path stripped). */
export const CAPTCHA_PATHS: ReadonlySet<string> = new Set([
	"/sign-up/email",
	"/sign-in/email",
	"/request-password-reset",
	"/forget-password",
	"/reset-password",
])

export interface CaptchaVerifier {
	/** True only when the provider confirmed the token. Never throws. */
	verify(token: string | null | undefined, remoteIp?: string | null): Promise<boolean>
}

/** Cloudflare Turnstile's server-side check. */
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

/** A provider that does not answer in this time counts as a failed check. */
const VERIFY_TIMEOUT_MS = 5_000

type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>

/**
 * Turnstile verifier. Fails closed: a missing token, a provider error, a
 * timeout or an unexpected answer all count as "not a person".
 */
export function createTurnstileVerifier(
	secret: string,
	fetchImpl: FetchLike = fetch as FetchLike
): CaptchaVerifier {
	return {
		async verify(token, remoteIp) {
			if (!token) return false
			try {
				const body = new URLSearchParams({ secret, response: token })
				if (remoteIp) body.set("remoteip", remoteIp)
				const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body,
					signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
				})
				if (!response.ok) return false
				const result = (await response.json()) as { success?: unknown }
				return result.success === true
			} catch (error) {
				// eslint-disable-next-line no-console -- provider failure is logged; the attempt is refused
				console.error(
					"[captcha] verification failed:",
					error instanceof Error ? error.message : String(error)
				)
				return false
			}
		},
	}
}

/** Lets every request through. Only for development and tests without a secret. */
export const allowAllCaptchaVerifier: CaptchaVerifier = {
	verify: async () => true,
}

/** Thrown when production boots without a CAPTCHA secret. */
export class MissingCaptchaConfigError extends Error {
	constructor() {
		super(
			"CAPTCHA_SECRET_KEY is not set. Production refuses to start without CAPTCHA on sign-up, " +
				"sign-in and password reset (TOR §II, COA Circular 2021-014). Set CAPTCHA_SECRET_KEY " +
				"to the Cloudflare Turnstile secret key, and NEXT_PUBLIC_TURNSTILE_SITE_KEY in the web app."
		)
		this.name = "MissingCaptchaConfigError"
	}
}

/**
 * The verifier for this process. With a secret, Turnstile. Without one,
 * production refuses to boot (same fail-closed rule as SMTP), and development
 * and tests let every request through, announced once.
 */
export function resolveCaptchaVerifier(opts: {
	secret?: string
	nodeEnv?: string
}): CaptchaVerifier {
	if (opts.secret) return createTurnstileVerifier(opts.secret)
	if (opts.nodeEnv === "production") throw new MissingCaptchaConfigError()
	// eslint-disable-next-line no-console -- dev without a CAPTCHA secret announces itself
	console.warn(
		"[captcha] CAPTCHA_SECRET_KEY is unset: CAPTCHA is NOT checked. Set it to enforce CAPTCHA locally."
	)
	return allowAllCaptchaVerifier
}