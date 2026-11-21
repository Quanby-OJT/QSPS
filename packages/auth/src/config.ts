import { createEnv } from "@t3-oss/env-core"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { PRIVACY_NOTICE_VERSION, type RoleName } from "@repo/contracts"
import { createDBClient } from "@repo/db/client"
import {
	accounts,
	roles,
	sessions,
	twoFactors,
	userRoles,
	users,
	verifications,
} from "@repo/db/schema"

import { isApiDocsEnabled } from "./api-docs.js"
import { emitAuthEvent } from "./auth-events.js"
import { authLogger } from "./auth-logger.js"
import { buildAuthPlugins, MFA_EMAIL_CODE_MINUTES } from "./auth-plugins.js"
import { AUTH_CLIENT_ADDRESS_HEADER } from "./client-address.js"
import { cookieDomainSchema } from "./cookie-domain-schema.js"
import { booleanFromEnv } from "./mailer/bool-schema.js"
import { sendMail } from "./mailer/send-mail.js"
import { buildResetPasswordEmail } from "./mailer/templates/reset-password-email.js"
import { buildTwoFactorCodeEmail } from "./mailer/templates/two-factor-code-email.js"
import { buildVerificationEmail } from "./mailer/templates/verification-email.js"
import { createTransport } from "./mailer/transport-factory.js"
import { parseOriginList } from "./origin-list.js"
import { rateLimitStorage } from "./rate-limit-storage.js"
import { withSafeDatabaseErrors } from "./safe-database-errors.js"
import { authSecretSchema } from "./secret-schema.js"

/**
 * Type-safe environment variable validation for Auth package
 *
 * Validates auth-related environment variables at module load time.
 * This ensures all required auth configuration is present before initialization.
 */
export const authEnv = createEnv({
	server: {
		// Authentication.
		// Shared with the backend's own env config via `authSecretSchema` so both
		// processes reject the same weak/placeholder secrets.
		BETTER_AUTH_SECRET: authSecretSchema,
		BETTER_AUTH_TRUSTED_ORIGINS: z.string(),
		// Any non-empty value used to enable cross-subdomain cookies,
		// so a typo silently widened the session cookie's scope. Unset by default,
		// which means a host-only cookie — the narrowest option.
		BETTER_AUTH_COOKIE_DOMAIN: cookieDomainSchema,

		// OAuth Providers (Google)
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),

		// SMTP / Mailer
		SMTP_HOST: z.string().optional(),
		SMTP_PORT: z.coerce.number().int().positive().optional(),
		SMTP_USER: z.string().optional(),
		SMTP_PASS: z.string().optional(),
		SMTP_SECURE: booleanFromEnv.optional().default(false),
		MAIL_FROM: z.string().optional().default('"Dev Mailer" <no-reply@localhost>'),
		APP_WEB_URL: z.string().url().optional().default("http://localhost:3001"),

		// Email verification behaviour
		EMAIL_VERIFICATION_ENABLED: booleanFromEnv.optional().default(true),
		// The PRD records this business decision as "verification required".
		// Defaulting it off meant an unverified address could sign in, which is
		// the opposite of what was agreed.
		EMAIL_VERIFICATION_REQUIRED: booleanFromEnv.optional().default(true),

		// Debug surfaces. No default: "unset" must stay visible so
		// `isApiDocsEnabled` can apply the shared rule (explicit flag wins,
		// otherwise on only in development; an unset NODE_ENV counts as
		// development). The backend resolves the same inputs.
		ENABLE_API_DOCS: booleanFromEnv.optional(),

		// Auth rate limiting
		AUTH_RATE_LIMIT_WINDOW: z.coerce.number().int().positive().optional().default(60),
		AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().optional().default(10),
	},
	runtimeEnv: process.env,
	// Validation is never skipped merely because CI is set.
	// It was disabled in exactly the environment meant to catch misconfiguration,
	// so a missing or malformed value shipped instead of failing the build.
	// `SKIP_ENV_VALIDATION` is the one documented escape hatch, for build-only
	// jobs that have no runtime configuration to validate.
	// `lint` stays exempt: ESLint loads modules for type information and has no
	// business asserting the runtime environment.
	skipValidation:
		process.env.SKIP_ENV_VALIDATION === "true" || process.env.npm_lifecycle_event === "lint",
})

/** The role every self-registered client account receives (AUTH-1). */
const CLIENT_ROLE: RoleName = "Client"

/**
 * Internal basePath used by Better Auth.
 * All versioned API requests (/api/v1/auth/*, /api/v2/auth/*, etc.) are
 * normalized to this path before being handled by Better Auth.
 */
export const AUTH_BASE_PATH = "/auth"

/**
 * Base URL for Better Auth (1.6 warns at init when this and `BETTER_AUTH_URL`
 * are both unset, then derives the origin from the request).
 *
 * `BETTER_AUTH_URL` is optional and is not added as a required setting: this
 * repo never required it, and CI builds run without auth configuration.
 * When it is set, it is passed through. When it is not, the origin stays
 * request-derived for hosts already listed in `BETTER_AUTH_TRUSTED_ORIGINS`,
 * which is the previous behaviour. Any other host falls back to the first
 * trusted origin instead of failing closed.
 */
function resolveAuthBaseURL(): string | { allowedHosts: string[]; fallback?: string } {
	const configured = process.env.BETTER_AUTH_URL
	if (configured) return configured

	const origins = parseOriginList(authEnv.BETTER_AUTH_TRUSTED_ORIGINS)
	const allowedHosts = new Set<string>()
	for (const origin of origins) {
		try {
			allowedHosts.add(new URL(origin).host)
		} catch {
			// Non-URL entries are ignored here; trustedOrigins still receives them.
		}
	}
	const hosts = [...allowedHosts]
	if (hosts.length === 0) hosts.push("localhost")

	const fallback = origins.find(origin => {
		try {
			return Boolean(new URL(origin).origin)
		} catch {
			return false
		}
	})
	return { allowedHosts: hosts, ...(fallback ? { fallback } : {}) }
}

/**
 * Creates a Better Auth instance configured with Drizzle adapter.
 *
 * The auth instance uses database connection from @repo/db and is
 * configured to work across multiple apps (backend, web, mobile via API).
 *
 * Uses a neutral basePath ("/auth") - the backend normalizes versioned
 * paths (/api/v1/auth/*, /api/v2/auth/*) to this basePath before handling.
 *
 * @returns Better Auth instance
 */
export function createAuth() {
	const db = createDBClient()

	// The mail transport throws in production when SMTP_HOST is unset, rather than
	// falling back to a transport that prints reset links and delivers nothing.
	const transporter = createTransport({
		smtpHost: authEnv.SMTP_HOST,
		smtpPort: authEnv.SMTP_PORT,
		smtpUser: authEnv.SMTP_USER,
		smtpPass: authEnv.SMTP_PASS,
		smtpSecure: authEnv.SMTP_SECURE,
		nodeEnv: process.env.NODE_ENV,
	})
	const mailFrom = authEnv.MAIL_FROM
	const appWebUrl = authEnv.APP_WEB_URL
	const verificationRequired = authEnv.EMAIL_VERIFICATION_REQUIRED
	// Requiring verification while sending is disabled produces accounts
	// that can never sign in — no mail is sent, so the gate never opens. The two
	// flags are made coherent here rather than left to trip an operator: if
	// verification is required, sending is on.
	const verificationEnabled = authEnv.EMAIL_VERIFICATION_ENABLED || verificationRequired

	return betterAuth({
		// Failed queries leave the adapter without their bound values.
		database: (options: Parameters<ReturnType<typeof drizzleAdapter>>[0]) =>
			withSafeDatabaseErrors(
				drizzleAdapter(db, {
					provider: "pg",
					schema: {
						users,
						sessions,
						accounts,
						verifications,
						twoFactors,
					},
					usePlural: true,
				})(options)
			),
		basePath: AUTH_BASE_PATH,
		logger: authLogger,
		baseURL: resolveAuthBaseURL(),
		secret: authEnv.BETTER_AUTH_SECRET,
		rateLimit: {
			enabled: true,
			// Counts in the host's shared store when one is registered (the backend
			// registers Redis), otherwise in this process. See rate-limit-storage.ts.
			customStorage: rateLimitStorage,
			window: authEnv.AUTH_RATE_LIMIT_WINDOW,
			max: authEnv.AUTH_RATE_LIMIT_MAX,
			customRules: {
				/**
				 * Session *reads* must not share the credential budget.
				 *
				 * `get-session` is what the app itself calls to resolve the viewer,
				 * once per server-rendered navigation. Under the shared limit those
				 * lookups consumed the same allowance as sign-in attempts, so a user
				 * who simply browsed enough pages within one window started getting
				 * 429s — and a 429 here reads as "no session", so the app renders
				 * them logged out and protected routes bounce to /login. Measured
				 * directly against this config: 30 reads succeeded and the next 10
				 * returned 429, with a valid cookie throughout.
				 *
				 * The exposure a limit would buy here is small — the endpoint takes
				 * no credentials and only echoes the session belonging to a cookie
				 * the caller already holds — so this is deliberately generous rather
				 * than disabled (`false`), keeping a ceiling on a flood while
				 * leaving normal browsing, and shared egress IPs, well clear of it.
				 *
				 * Sign-in, sign-up, change-password and change-email are not
				 * overridden. better-auth special-cases those paths at 3 requests
				 * / 10s, and a custom rule replaces that special case. Reset and
				 * verification sends are special-cased at 3 / 60s; the rules below
				 * keep this config's credential budget on those paths only.
				 */
				"/get-session": { window: authEnv.AUTH_RATE_LIMIT_WINDOW, max: 500 },
				"/request-password-reset": {
					window: authEnv.AUTH_RATE_LIMIT_WINDOW,
					max: authEnv.AUTH_RATE_LIMIT_MAX,
				},
				"/send-verification-email": {
					window: authEnv.AUTH_RATE_LIMIT_WINDOW,
					max: authEnv.AUTH_RATE_LIMIT_MAX,
				},
				"/forget-password": {
					window: authEnv.AUTH_RATE_LIMIT_WINDOW,
					max: authEnv.AUTH_RATE_LIMIT_MAX,
				},
				"/forget-password/*": {
					window: authEnv.AUTH_RATE_LIMIT_WINDOW,
					max: authEnv.AUTH_RATE_LIMIT_MAX,
				},
			},
		},
		emailVerification: {
			sendOnSignUp: verificationEnabled,
			// AUTH-1 audit: the backend records this through AuditService.
			afterEmailVerification: async user => {
				await emitAuthEvent({ type: "user.email_verified", userId: user.id })
			},
			sendVerificationEmail: async ({ user, token }) => {
				// Honor disabled-sending config for both automatic signup sends
				// and explicit resend-verification actions.
				if (!verificationEnabled) {
					return
				}

				const verificationUrl = `${appWebUrl}/verify-email?token=${token}`
				const email = buildVerificationEmail({
					verificationUrl,
					userEmail: user.email,
				})
				const message = {
					to: user.email,
					subject: email.subject,
					html: email.html,
					text: email.text,
				}

				if (verificationRequired) {
					try {
						await sendMail(transporter, mailFrom, message)
					} catch (err) {
						// Log the raw transport failure server-side, but surface a
						// sanitized error to clients so SMTP internals never leak.
						// eslint-disable-next-line no-console -- transport failure is logged server-side and never returned
						console.error("[mailer] verification email failed:", err)
						throw new APIError("INTERNAL_SERVER_ERROR", {
							message: "Verification email is currently unavailable. Please try again later.",
						})
					}
				} else {
					try {
						await sendMail(transporter, mailFrom, message)
					} catch (err) {
						// eslint-disable-next-line no-console -- transport failure is logged server-side and never returned
						console.error("[mailer] verification email failed:", err)
					}
				}
			},
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: verificationRequired,
			// AUTH-1: a completed reset signs the account out everywhere, so a
			// session opened with the old password does not outlive it. The reset
			// token itself is single-use (Better Auth deletes it when consumed).
			revokeSessionsOnPasswordReset: true,
			/**
			 * Send a password-reset link.
			 *
			 * Failures are swallowed on purpose. Better Auth already returns the
			 * same generic response whether or not the account exists; letting a
			 * transport error escape from here would break that, because a
			 * mailable address would 200 while an SMTP failure 500'd — turning
			 * the endpoint into an account-enumeration oracle for anyone who can
			 * make delivery fail for one address and not another.
			 *
			 * The real error goes to the server log, where the Pino redaction
			 * applies, and never to the client: raw transport errors disclose
			 * host, port and credentials-in-use.
			 */
			sendResetPassword: async ({ user, token }) => {
				try {
					const resetUrl = `${appWebUrl}/reset-password?token=${token}`
					const email = buildResetPasswordEmail({
						resetUrl,
						userEmail: user.email,
					})
					await sendMail(transporter, mailFrom, {
						to: user.email,
						subject: email.subject,
						html: email.html,
						text: email.text,
					})
				} catch (err) {
					// Logged, not returned. The message is deliberately free of the
					// address and the reset URL — both are credentials in this flow.
					// eslint-disable-next-line no-console -- reset delivery failure is logged so the client response stays generic
					console.error("[mailer] password reset email failed:", err)
				}
			},
			/**
			 * ADM-1: a staff account is created with `must_reset_password` set and
			 * an emailed set-password link. Completing any password reset clears the
			 * flag. Runs from the reset itself, not a hook on the request: a reset
			 * from the email link has no session, so the user comes from here.
			 */
			onPasswordReset: async ({ user }) => {
				await db
					.update(users)
					.set({ mustResetPassword: false, updatedAt: new Date() })
					.where(eq(users.id, user.id))
			},
		},
		/**
		 * QSPS columns on `users` that Better Auth reads or writes (AUTH-1).
		 *
		 * Only `privacyNoticeVersion` is accepted from the client, on sign-up; the
		 * rest are set by the server. Profile details (mobile, birth date, …) are
		 * written by the profile API, not through Better Auth.
		 */
		user: {
			additionalFields: {
				privacyNoticeVersion: { type: "string", required: false, input: true },
				// Not returned: on a duplicate sign-up Better Auth answers with a stand-in
				// user, and a null here versus a timestamp on a real account would tell
				// a caller which addresses are registered.
				privacyAcceptedAt: { type: "date", required: false, input: false, returned: false },
				accountType: { type: "string", required: false, input: false, defaultValue: "client" },
				profileCompletedAt: { type: "date", required: false, input: false },
				// ADM-1 account lifecycle. Server-set only; the two timestamps are not
				// returned, so a session payload never discloses an account's status.
				mustResetPassword: { type: "boolean", required: false, input: false, defaultValue: false },
				disabledAt: { type: "date", required: false, input: false, returned: false },
				deletedAt: { type: "date", required: false, input: false, returned: false },
			},
		},

		/**
		 * Consent is checked before Better Auth touches the database, so a missing
		 * or outdated notice version gets a clear 400. The database hook below
		 * keeps the same rule as a second line of defense.
		 */
		hooks: {
			before: createAuthMiddleware(async ctx => {
				if (ctx.path !== "/sign-up/email") return
				const accepted = (ctx.body as Record<string, unknown> | undefined)?.privacyNoticeVersion
				if (accepted !== PRIVACY_NOTICE_VERSION) {
					throw ctx.error("BAD_REQUEST", {
						message: "Please read and accept the privacy notice to create an account.",
					})
				}
			}),
		},

		databaseHooks: {
			user: {
				create: {
					/**
					 * Data Privacy Act consent (AUTH-1). No account is created unless the
					 * sign-up names the notice version currently shown; the server, not
					 * the client, stamps when it was accepted.
					 */
					before: async user => {
						const accepted = (user as Record<string, unknown>).privacyNoticeVersion
						if (accepted !== PRIVACY_NOTICE_VERSION) {
							throw new APIError("BAD_REQUEST", {
								message: "Please read and accept the privacy notice to create an account.",
							})
						}
						return { data: { ...user, privacyAcceptedAt: new Date() } }
					},
					/**
					 * Every self-registered account is a client and gets the Client role.
					 * Staff accounts (ADM-1) are given their roles by an administrator.
					 * Skipped when the Client role is missing (the catalog migration creates it).
					 */
					after: async user => {
						await emitAuthEvent({ type: "user.registered", userId: user.id })
						if ((user as Record<string, unknown>).accountType === "staff") return
						const [clientRole] = await db
							.select({ id: roles.id })
							.from(roles)
							.where(eq(roles.name, CLIENT_ROLE))
						if (!clientRole) return
						await db
							.insert(userRoles)
							.values({ userId: user.id, roleId: clientRole.id })
							.onConflictDoNothing()
					},
				},
				update: {
					/** Consent is recorded once, at sign-up; it cannot be edited afterwards. */
					before: async data => {
						const rest = { ...(data as Record<string, unknown>) }
						delete rest.privacyNoticeVersion
						delete rest.privacyAcceptedAt
						return { data: rest }
					},
				},
			},
			session: {
				create: {
					/**
					 * ADM-1: disabled and soft-deleted accounts cannot sign in. Checked
					 * when the session is created, so it covers every sign-in method
					 * (password, Google) after the credentials were already verified.
					 */
					before: async session => {
						const [account] = await db
							.select({ disabledAt: users.disabledAt, deletedAt: users.deletedAt })
							.from(users)
							.where(eq(users.id, session.userId))
						if (!account || account.disabledAt !== null || account.deletedAt !== null) {
							throw new APIError("FORBIDDEN", {
								message: "This account is disabled or no longer active.",
							})
						}
					},
					/** AUTH-1 audit: every new session is a sign-in. */
					after: async session => {
						await emitAuthEvent({ type: "session.created", userId: session.userId })
					},
				},
			},
		},

		/**
		 * The Google provider is registered only when BOTH
		 * credentials are present.
		 *
		 * It used to register unconditionally with `as string` casting
		 * `undefined` into the config, so a half-configured deployment exposed a
		 * sign-in route that could only fail — and failed in whatever way the
		 * provider chose, not in a way this app controls. The cast is gone; the
		 * absence is now expressed in the type system rather than hidden from it.
		 */
		socialProviders: {
			...(authEnv.GOOGLE_CLIENT_ID && authEnv.GOOGLE_CLIENT_SECRET
				? {
						google: {
							prompt: "select_account" as const,
							clientId: authEnv.GOOGLE_CLIENT_ID,
							clientSecret: authEnv.GOOGLE_CLIENT_SECRET,
						},
					}
				: {}),
		},
		// Origins are trimmed and empty entries are filtered. A list written with spaces
		// after the commas produced entries like " http://localhost:3001" that
		// match nothing, and a trailing comma produced an empty string — which
		// some origin checks treat as "any". Both are silent failures.
		trustedOrigins: parseOriginList(authEnv.BETTER_AUTH_TRUSTED_ORIGINS),

		/**
		 * Session lifetime is pinned rather than inherited.
		 *
		 * These rode library defaults, so the security posture was whatever the
		 * installed version happened to choose and could change under a patch
		 * upgrade without anyone noticing.
		 */
		session: {
			// Absolute lifetime of a session record.
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			// Sliding renewal: an active session is extended once a day, so a
			// user in daily use is not signed out mid-work, while an abandoned
			// session still dies within the window above.
			updateAge: 60 * 60 * 24, // 1 day
			// Cookie cache is deliberately OFF. It serves session data from a
			// signed cookie without hitting the database, which means a revoked
			// session keeps working until the cache lapses — the same staleness the
			// shared permission cache removed from the RBAC cache, and not worth reintroducing here.
			cookieCache: { enabled: false },
		},

		/**
		 * Account linking is stated explicitly.
		 *
		 * Trusted providers only, and only ones that verify the address they
		 * assert. An unverified email is not linked automatically.
		 */
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ["google"],
				allowDifferentEmails: false,
			},
		},

		advanced: {
			/**
			 * Client address for the rate limiter.
			 *
			 * The backend writes one address — the one Express resolved — into
			 * this header and removes any inbound value first. Listing it here
			 * replaces the default `x-forwarded-for` read, which rejects a
			 * multi-entry chain and then shares one per-path bucket.
			 * `trustedProxies` stays unset; those ranges are managed outside
			 * this repo.
			 */
			ipAddress: {
				ipAddressHeaders: [AUTH_CLIENT_ADDRESS_HEADER],
			},
			/**
			 * Cookie attributes are pinned.
			 *
			 * The open question was which SameSite posture applies, because it gates how bad
			 * the clickjacking is. The answer is `lax`, chosen not defaulted:
			 *
			 *  - `strict` breaks the OAuth return leg — the browser drops the
			 *    cookie on the top-level redirect back from Google, so the user
			 *    lands signed out.
			 *  - `none` would let any site send the session cookie on cross-site
			 *    requests, which is exactly the CSRF surface to avoid.
			 *  - `lax` withholds the cookie on cross-site subrequests (the CSRF
			 *    case) while allowing it on top-level navigations (the OAuth
			 *    case).
			 *
			 * With `lax` here and the CSP's `frame-ancestors 'none'`, framing is closed
			 * from both directions: the page cannot be framed, and even if it
			 * were, the cookie would not ride a cross-site subrequest.
			 */
			// Leave forwarded-host selection off. The node adapter already builds
			// the request URL from the Host header; trusting x-forwarded-host on
			// top of the dynamic base URL would accept a client-supplied host.
			trustedProxyHeaders: false,
			defaultCookieAttributes: {
				httpOnly: true,
				sameSite: "lax",
				// Secure in production only: a Secure cookie is dropped over plain
				// HTTP, which would break local development on http://localhost.
				secure: process.env.NODE_ENV === "production",
				path: "/",
			},
			...(authEnv.BETTER_AUTH_COOKIE_DOMAIN && {
				crossSubDomainCookies: {
					enabled: true,
					domain: authEnv.BETTER_AUTH_COOKIE_DOMAIN,
				},
			}),
		},
		/**
		 * The openAPI reference is a debug surface and is
		 * registered only when API docs are enabled.
		 *
		 * It used to mount unconditionally, so `/api/v1/auth/reference` listed
		 * every auth route in production. `buildAuthPlugins` applies
		 * `isApiDocsEnabled` — the same rule the backend uses for Scalar and
		 * `spec.json` — so the two cannot disagree.
		 */
		plugins: buildAuthPlugins(isApiDocsEnabled(process.env.NODE_ENV, authEnv.ENABLE_API_DOCS), {
			/**
			 * AUTH-2: the emailed one-time sign-in code. Unlike a reset link, a
			 * failure here is surfaced: the user is already past the password
			 * and waiting for this code, so a silent failure would strand them.
			 * The message stays generic; the transport error goes to the log.
			 */
			sendTwoFactorOtp: async ({ email, otp }) => {
				const message = buildTwoFactorCodeEmail({ code: otp, minutes: MFA_EMAIL_CODE_MINUTES })
				try {
					await sendMail(transporter, mailFrom, {
						to: email,
						subject: message.subject,
						html: message.html,
						text: message.text,
					})
				} catch (err) {
					// eslint-disable-next-line no-console -- transport failure is logged server-side and never returned
					console.error("[mailer] sign-in code email failed:", err)
					throw new APIError("INTERNAL_SERVER_ERROR", {
						message:
							"The sign-in code could not be sent. Please try again or use your authenticator app.",
					})
				}
			},
		}),
	})
}

/**
 * Default Better Auth instance.
 * This is the shared instance used across all apps.
 *
 * Lazy initialization to ensure environment variables are loaded before creating the instance.
 */
type AuthInstance = ReturnType<typeof createAuth>

let _auth: AuthInstance | null = null

/**
 * Clear the cached auth instance. Call this when configuration changes.
 */
export function clearAuthCache(): void {
	_auth = null
}

export function getAuth(): AuthInstance {
	if (!_auth) {
		_auth = createAuth()
	}
	return _auth!
}

/**
 * Inferred Session type from Better Auth.
 * Export this so web app can use the correct types matching backend config.
 */
export type Session = ReturnType<typeof getAuth>["$Infer"]["Session"]
