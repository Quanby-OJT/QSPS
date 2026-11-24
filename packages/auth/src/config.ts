import { createEnv } from "@t3-oss/env-core"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api"
import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { ADMIN_ROLE, PRIVACY_NOTICE_VERSION, type RoleName } from "@repo/contracts"
import { createDBClient } from "@repo/db/client"
import {
	accounts,
	passwordHistory,
	permissions,
	rolePermissions,
	roles,
	sessions,
	twoFactors,
	userRoles,
	users,
	verifications,
} from "@repo/db/schema"

import { isApiDocsEnabled } from "./api-docs.js"
import { emitAuthEvent, type MfaMethod } from "./auth-events.js"
import { authLogger } from "./auth-logger.js"
import { buildAuthPlugins, MFA_EMAIL_CODE_MINUTES } from "./auth-plugins.js"
import {
	isPasswordExpired,
	PASSWORD_HISTORY_DEPTH,
	readAuthPolicies,
	type AuthPolicies,
} from "./auth-policies.js"
import { CAPTCHA_HEADER, CAPTCHA_PATHS, resolveCaptchaVerifier } from "./captcha.js"
import { AUTH_CLIENT_ADDRESS_HEADER } from "./client-address.js"
import { cookieDomainSchema } from "./cookie-domain-schema.js"
import { lockoutKey, lockoutStore } from "./lockout-store.js"
import { booleanFromEnv } from "./mailer/bool-schema.js"
import { sendMail } from "./mailer/send-mail.js"
import { buildAccountLockedEmail } from "./mailer/templates/account-locked-email.js"
import { buildResetPasswordEmail } from "./mailer/templates/reset-password-email.js"
import { buildTwoFactorCodeEmail } from "./mailer/templates/two-factor-code-email.js"
import { buildVerificationEmail } from "./mailer/templates/verification-email.js"
import { createTransport } from "./mailer/transport-factory.js"
import { parseOriginList } from "./origin-list.js"
import { rateLimitStorage } from "./rate-limit-storage.js"
import { withSafeDatabaseErrors } from "./safe-database-errors.js"
import { authSecretSchema } from "./secret-schema.js"
import { createSmsSender, normalizeSmsNumber, reserveSmsCode, SmsRateLimitError } from "./sms.js"

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

		// AUTH-3 (TOR §II, COA Circular 2021-014).
		// Cloudflare Turnstile secret key. Required in production (boot fails
		// without it); unset in development means CAPTCHA is not checked.
		CAPTCHA_SECRET_KEY: z.string().optional(),
		// Policy defaults until ADM-6 (PolicyService): `auth.lockout_threshold`,
		// `auth.lockout_minutes`, `auth.staff_password_max_age_days`.
		AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().optional().default(5),
		AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().optional().default(15),
		AUTH_STAFF_PASSWORD_MAX_AGE_DAYS: z.coerce.number().int().positive().optional().default(90),
		// A session unused this long ends (idle timeout). Active use renews it.
		AUTH_SESSION_IDLE_HOURS: z.coerce.number().int().positive().optional().default(8),
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
 * AUTH-2: endpoints that change a user's own second-factor settings. They
 * need `account.profile:manage` (clients); staff are exempt because MFA is
 * mandatory for them and their roles do not carry that key.
 */
const MFA_SETTINGS_PATHS = new Set([
	"/two-factor/enable",
	"/two-factor/disable",
	"/two-factor/generate-backup-codes",
	"/two-factor/get-totp-uri",
])
const MFA_SETTINGS_PERMISSION = "account.profile:manage"

/** AUTH-2: the challenge endpoints, and which factor each one checks. */
const MFA_VERIFY_METHODS: Record<string, MfaMethod> = {
	"/two-factor/verify-totp": "totp",
	"/two-factor/verify-otp": "otp",
	"/two-factor/verify-backup-code": "backup_code",
}

/** Cookie the two-factor plugin sets between the password step and the code step. */
const TWO_FACTOR_CHALLENGE_COOKIE = "two_factor"

/**
 * Whether a user holds a permission key, read straight from the database
 * with the same rules as `RbacService`: Super Admin holds everything, and
 * `<resource>:*` covers any action on that resource. The auth package cannot
 * reach the backend's RBAC service, so it repeats this one check here.
 */
async function holdsPermission(
	db: ReturnType<typeof createDBClient>,
	userId: string,
	key: string
): Promise<boolean> {
	const resource = key.slice(0, key.indexOf(":"))
	const rows = await db
		.select({ role: roles.name, permission: permissions.name })
		.from(userRoles)
		.innerJoin(roles, eq(userRoles.roleId, roles.id))
		.leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
		.leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
		.where(eq(userRoles.userId, userId))
	return rows.some(
		row => row.role === ADMIN_ROLE || row.permission === key || row.permission === `${resource}:*`
	)
}

type Database = ReturnType<typeof createDBClient>

/** Better Auth's provider id for email-and-password accounts. */
const CREDENTIAL_PROVIDER = "credential"

/** AUTH-3: the account behind an email, if there is one. */
async function findUserByEmail(db: Database, email: string): Promise<{ id: string } | null> {
	const [row] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email.trim().toLowerCase()))
	return row ?? null
}

async function isStaffAccount(db: Database, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ accountType: users.accountType })
		.from(users)
		.where(eq(users.id, userId))
	return row?.accountType === "staff"
}

/** The current password hash, as Better Auth stores it on the credential account. */
async function credentialHash(db: Database, userId: string): Promise<string | null> {
	const [row] = await db
		.select({ password: accounts.password })
		.from(accounts)
		.where(and(eq(accounts.userId, userId), eq(accounts.providerId, CREDENTIAL_PROVIDER)))
	return row?.password ?? null
}

/** AUTH-3: the current hash and the recent ones, newest first, at most PASSWORD_HISTORY_DEPTH. */
async function recentPasswordHashes(db: Database, userId: string): Promise<string[]> {
	const history = await db
		.select({ hash: passwordHistory.passwordHash })
		.from(passwordHistory)
		.where(eq(passwordHistory.userId, userId))
		.orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id))
		.limit(PASSWORD_HISTORY_DEPTH)
	const current = await credentialHash(db, userId)
	const hashes = [...(current ? [current] : []), ...history.map(row => row.hash)]
	return [...new Set(hashes)].slice(0, PASSWORD_HISTORY_DEPTH)
}

/**
 * AUTH-3: keep the password about to be replaced in the history. A password
 * set before AUTH-3 (or a temporary one from an admin) was never recorded, so
 * without this it could be reused right after the change.
 */
async function rememberCurrentPassword(db: Database, userId: string): Promise<void> {
	const current = await credentialHash(db, userId)
	if (!current) return
	const [newest] = await db
		.select({ hash: passwordHistory.passwordHash })
		.from(passwordHistory)
		.where(eq(passwordHistory.userId, userId))
		.orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id))
		.limit(1)
	if (newest?.hash === current) return
	await db.insert(passwordHistory).values({ userId, passwordHash: current })
}

/**
 * AUTH-3: a password was just set or changed. Stamps `password_changed_at`,
 * clears `must_reset_password`, and for staff keeps the new hash in
 * `password_history` (newest five kept).
 */
async function recordPasswordSet(db: Database, userId: string): Promise<void> {
	if (await isStaffAccount(db, userId)) {
		const hash = await credentialHash(db, userId)
		if (hash) {
			await db.insert(passwordHistory).values({ userId, passwordHash: hash })
			const rows = await db
				.select({ id: passwordHistory.id })
				.from(passwordHistory)
				.where(eq(passwordHistory.userId, userId))
				.orderBy(desc(passwordHistory.createdAt), desc(passwordHistory.id))
			const stale = rows.slice(PASSWORD_HISTORY_DEPTH).map(row => row.id)
			if (stale.length > 0) {
				await db.delete(passwordHistory).where(inArray(passwordHistory.id, stale))
			}
		}
	}
	const now = new Date()
	await db
		.update(users)
		.set({ passwordChangedAt: now, mustResetPassword: false, updatedAt: now })
		.where(eq(users.id, userId))
	await emitAuthEvent({ type: "password.changed", userId })
}

/** AUTH-3: the answer while an account is locked. 429 with Retry-After, like the rate limiter. */
function accountLockedError(secondsLeft: number): APIError {
	const minutes = Math.max(1, Math.ceil(secondsLeft / 60))
	return new APIError(
		"TOO_MANY_REQUESTS",
		{
			code: "ACCOUNT_LOCKED",
			message: `Too many failed sign-ins. This account is locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
		},
		{ "X-Retry-After": String(secondsLeft), "Retry-After": String(secondsLeft) }
	)
}

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

	// AUTH-3. Production refuses to boot without a CAPTCHA secret.
	const captcha = resolveCaptchaVerifier({
		secret: authEnv.CAPTCHA_SECRET_KEY,
		nodeEnv: process.env.NODE_ENV,
	})
	const policyDefaults: AuthPolicies = {
		lockoutThreshold: authEnv.AUTH_LOCKOUT_THRESHOLD,
		lockoutMinutes: authEnv.AUTH_LOCKOUT_MINUTES,
		staffPasswordMaxAgeDays: authEnv.AUTH_STAFF_PASSWORD_MAX_AGE_DAYS,
	}
	const policies = () => readAuthPolicies(policyDefaults)

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
				// AUTH-3: also stamps password_changed_at and keeps staff password history.
				await recordPasswordSet(db, user.id)
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
				/**
				 * AUTH-3: CAPTCHA first, before any database work. The token comes
				 * in a header so the forms' JSON bodies stay as Better Auth expects.
				 */
				// A call from our own server code (auth.api.* with no HTTP request,
				// e.g. the PRC-2 walk-in invitation) has no browser to solve a
				// CAPTCHA and cannot come from the internet. Every HTTP request is checked.
				if (CAPTCHA_PATHS.has(ctx.path) && ctx.request) {
					const token = ctx.headers?.get(CAPTCHA_HEADER) ?? null
					const address = ctx.headers?.get(AUTH_CLIENT_ADDRESS_HEADER) ?? null
					if (!(await captcha.verify(token, address))) {
						throw new APIError("BAD_REQUEST", {
							code: "CAPTCHA_FAILED",
							message: "Please complete the CAPTCHA check and try again.",
						})
					}
				}

				/**
				 * AUTH-3: a locked account is refused before the password is checked,
				 * so guessing during the lock learns nothing. Counted per email, so
				 * the answer is the same for addresses with no account.
				 */
				if (ctx.path === "/sign-in/email") {
					const email = (ctx.body as { email?: unknown } | undefined)?.email
					if (typeof email !== "string") return
					const secondsLeft = await lockoutStore.lockedFor(lockoutKey(email))
					if (secondsLeft === null) return
					const user = await findUserByEmail(db, email)
					if (user) await emitAuthEvent({ type: "sign_in.locked", userId: user.id })
					throw accountLockedError(secondsLeft)
				}

				/**
				 * AUTH-3: a staff password must differ from the last five. Checked
				 * on both ways a password changes: the reset link and the signed-in
				 * change (including the forced change after rotation).
				 */
				if (ctx.path === "/change-password" || ctx.path === "/reset-password") {
					const body = ctx.body as { newPassword?: unknown; token?: unknown } | undefined
					const newPassword = body?.newPassword
					if (typeof newPassword !== "string") return
					let userId: string | null = null
					if (ctx.path === "/change-password") {
						userId = (await getSessionFromCtx(ctx))?.user.id ?? null
					} else {
						const token =
							typeof body?.token === "string"
								? body.token
								: (ctx.query as { token?: unknown } | undefined)?.token
						if (typeof token === "string") {
							const record = await ctx.context.internalAdapter.findVerificationValue(
								`reset-password:${token}`
							)
							userId = record?.value ?? null
						}
					}
					if (!userId || !(await isStaffAccount(db, userId))) return
					for (const hash of await recentPasswordHashes(db, userId)) {
						if (await ctx.context.password.verify({ hash, password: newPassword })) {
							await emitAuthEvent({ type: "password.reuse_refused", userId })
							throw new APIError("BAD_REQUEST", {
								code: "PASSWORD_REUSED",
								message: `Choose a password you have not used recently. It must differ from your last ${PASSWORD_HISTORY_DEPTH} passwords.`,
							})
						}
					}
					await rememberCurrentPassword(db, userId)
					return
				}

				if (ctx.path === "/sign-up/email") {
					const accepted = (ctx.body as Record<string, unknown> | undefined)?.privacyNoticeVersion
					if (accepted !== PRIVACY_NOTICE_VERSION) {
						throw ctx.error("BAD_REQUEST", {
							message: "Please read and accept the privacy notice to create an account.",
						})
					}
					return
				}

				/**
				 * AUTH-2: rules on changing second-factor settings. Checked before
				 * the plugin runs, so a refused change never touches the database.
				 * Without a session the plugin itself answers 401.
				 */
				if (ctx.path === "/two-factor/send-otp") {
					let userId = (await getSessionFromCtx(ctx))?.user.id ?? null
					if (!userId) {
						const cookie = ctx.context.createAuthCookie(TWO_FACTOR_CHALLENGE_COOKIE)
						const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
						const record = identifier
							? await ctx.context.internalAdapter.findVerificationValue(identifier)
							: null
						if (record && new Date(record.expiresAt).getTime() > Date.now()) userId = record.value
					}
					if (userId) {
						const [recipient] = await db
							.select({
								mobile: users.mobile,
								mobileVerifiedAt: users.mobileVerifiedAt,
								channel: users.mfaOtpChannel,
							})
							.from(users)
							.where(eq(users.id, userId))
						if (recipient?.channel === "sms") {
							const mobile = recipient.mobile ? normalizeSmsNumber(recipient.mobile) : null
							if (!mobile || !recipient.mobileVerifiedAt)
								throw new APIError("BAD_REQUEST", {
									message: "A verified mobile number is required for SMS codes.",
								})
							try {
								createSmsSender()
								// Better Auth catches delivery callback errors. Refuse exhausted
								// requests before it creates a new OTP or calls the provider.
								await reserveSmsCode(db, authEnv.BETTER_AUTH_SECRET, mobile, userId)
							} catch (error) {
								if (error instanceof SmsRateLimitError)
									throw new APIError("TOO_MANY_REQUESTS", { message: error.message })
								throw new APIError("INTERNAL_SERVER_ERROR", {
									message: "SMS sign-in codes are unavailable. Use your authenticator app.",
								})
							}
						}
					}
					return
				}
				if (MFA_SETTINGS_PATHS.has(ctx.path)) {
					const session = await getSessionFromCtx(ctx)
					if (!session) return
					const userId = session.user.id
					const isStaff = (session.user as Record<string, unknown>).accountType === "staff"

					if (ctx.path === "/two-factor/disable" && isStaff) {
						await emitAuthEvent({
							type: "mfa.refused",
							userId,
							reason: "staff accounts must keep two-factor authentication on",
						})
						throw new APIError("FORBIDDEN", {
							message:
								"Two-factor authentication is required for staff accounts and cannot be turned off.",
						})
					}

					if (!isStaff && !(await holdsPermission(db, userId, MFA_SETTINGS_PERMISSION))) {
						await emitAuthEvent({
							type: "mfa.refused",
							userId,
							reason: `missing ${MFA_SETTINGS_PERMISSION}`,
						})
						throw new APIError("FORBIDDEN", {
							message: "You do not have permission to change sign-in security settings.",
						})
					}
				}
			}),

			/**
			 * AUTH-2 audit: enrolment, disabling, and every second-factor
			 * attempt, successful or not. Runs after the plugin, so the outcome
			 * is known (`returned` is an APIError when the attempt failed).
			 */
			after: createAuthMiddleware(async ctx => {
				const failed = ctx.context.returned instanceof APIError
				const signedInUserId = ctx.context.session?.user.id

				/**
				 * AUTH-3: count wrong passwords per email. A correct password (even
				 * one still waiting for its second factor) clears the count. At the
				 * threshold the email is locked and the owner is told by email.
				 */
				if (ctx.path === "/sign-in/email") {
					const email = (ctx.body as { email?: unknown } | undefined)?.email
					if (typeof email !== "string") return
					const key = lockoutKey(email)
					const returned = ctx.context.returned
					if (!(returned instanceof APIError)) {
						await lockoutStore.clearFailures(key)
						return
					}
					// Only a wrong email or password counts, not an unverified or disabled account.
					if (returned.statusCode !== 401) return

					const { lockoutThreshold, lockoutMinutes } = await policies()
					const attempts = await lockoutStore.recordFailure(key, lockoutMinutes * 60)
					const user = await findUserByEmail(db, email)
					if (user) await emitAuthEvent({ type: "sign_in.failed", userId: user.id })
					if (attempts < lockoutThreshold) return

					await lockoutStore.lock(key, lockoutMinutes * 60)
					await lockoutStore.clearFailures(key)
					if (!user) return
					await emitAuthEvent({
						type: "account.locked",
						userId: user.id,
						attempts,
						minutes: lockoutMinutes,
					})
					try {
						const message = buildAccountLockedEmail({ minutes: lockoutMinutes, attempts })
						await sendMail(transporter, mailFrom, {
							to: email.trim().toLowerCase(),
							subject: message.subject,
							html: message.html,
							text: message.text,
						})
					} catch (err) {
						// eslint-disable-next-line no-console -- delivery failure is logged; the lock stands
						console.error("[mailer] account locked email failed:", err)
					}
					return
				}

				/** AUTH-3: a signed-in password change (including the forced one after rotation). */
				if (ctx.path === "/change-password") {
					if (!failed && signedInUserId) await recordPasswordSet(db, signedInUserId)
					return
				}

				if (ctx.path === "/two-factor/disable") {
					if (!failed && signedInUserId) {
						await emitAuthEvent({ type: "mfa.disabled", userId: signedInUserId })
					}
					return
				}

				const method = MFA_VERIFY_METHODS[ctx.path]
				if (!method) return

				if (!failed) {
					// Signed in already: the code confirmed a new authenticator (enrolment).
					// Otherwise the code finished a sign-in and created the session.
					if (signedInUserId && method === "totp") {
						await emitAuthEvent({ type: "mfa.enabled", userId: signedInUserId })
						return
					}
					const userId = ctx.context.newSession?.user.id ?? signedInUserId
					if (userId) await emitAuthEvent({ type: "mfa.verified", userId, method })
					return
				}

				// A wrong code during sign-in has no session yet: the user is the
				// one named by the plugin's signed challenge cookie.
				let userId = signedInUserId ?? null
				if (!userId) {
					try {
						const cookie = ctx.context.createAuthCookie(TWO_FACTOR_CHALLENGE_COOKIE)
						const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
						const record = identifier
							? await ctx.context.internalAdapter.findVerificationValue(identifier)
							: null
						userId = record?.value ?? null
					} catch {
						userId = null
					}
				}
				if (!userId) return

				const [state] = await db
					.select({ lockedUntil: twoFactors.lockedUntil })
					.from(twoFactors)
					.where(eq(twoFactors.userId, userId))
				const locked = Boolean(state?.lockedUntil && state.lockedUntil.getTime() > Date.now())
				await emitAuthEvent({ type: locked ? "mfa.locked" : "mfa.failed", userId, method })
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
							.select({
								disabledAt: users.disabledAt,
								deletedAt: users.deletedAt,
								accountType: users.accountType,
								mustResetPassword: users.mustResetPassword,
								passwordChangedAt: users.passwordChangedAt,
								createdAt: users.createdAt,
							})
							.from(users)
							.where(eq(users.id, session.userId))
						if (!account || account.disabledAt !== null || account.deletedAt !== null) {
							throw new APIError("FORBIDDEN", {
								message: "This account is disabled or no longer active.",
							})
						}

						/**
						 * AUTH-3: a staff password older than the rotation Policy must
						 * be changed. The sign-in still succeeds, but
						 * `must_reset_password` keeps the account on the change-password
						 * screen (web) and refuses the API until it is changed.
						 */
						if (account.accountType === "staff" && !account.mustResetPassword) {
							const { staffPasswordMaxAgeDays } = await policies()
							if (
								isPasswordExpired(
									account.passwordChangedAt,
									account.createdAt,
									staffPasswordMaxAgeDays
								)
							) {
								await db
									.update(users)
									.set({ mustResetPassword: true, updatedAt: new Date() })
									.where(eq(users.id, session.userId))
								await emitAuthEvent({ type: "password.expired", userId: session.userId })
							}
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
			// AUTH-3 idle timeout: a session unused for AUTH_SESSION_IDLE_HOURS
			// (default 8) ends. It was 7 days.
			expiresIn: 60 * 60 * authEnv.AUTH_SESSION_IDLE_HOURS,
			// Sliding renewal every 15 minutes of use, so a user at work is
			// never signed out mid-task while an idle session still ends on time.
			updateAge: 60 * 15,
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
			sendTwoFactorOtp: async ({ userId, email, otp }) => {
				const [recipient] = await db
					.select({
						mobile: users.mobile,
						mobileVerifiedAt: users.mobileVerifiedAt,
						channel: users.mfaOtpChannel,
					})
					.from(users)
					.where(eq(users.id, userId))
				if (recipient?.channel === "sms") {
					const mobile = recipient.mobile ? normalizeSmsNumber(recipient.mobile) : null
					if (!mobile || !recipient.mobileVerifiedAt)
						throw new APIError("BAD_REQUEST", {
							message: "A verified mobile number is required for SMS codes.",
						})
					try {
						await createSmsSender().send(
							mobile,
							`Your QSPS sign-in code is ${otp}. Valid for 5 minutes. Do not share it.`
						)
						return
					} catch {
						throw new APIError("INTERNAL_SERVER_ERROR", {
							message: "The SMS code could not be sent. Try again or use your authenticator app.",
						})
					}
				}
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
