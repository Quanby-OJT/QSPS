import { createEnv } from "@t3-oss/env-core"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { PRIVACY_NOTICE_VERSION, type RoleName } from "@repo/contracts"
import { createDBClient } from "@repo/db/client"
import { accounts, roles, sessions, userRoles, users, verifications } from "@repo/db/schema"

import { isApiDocsEnabled } from "./api-docs.js"
import { emitAuthEvent } from "./auth-events.js"
import { authLogger } from "./auth-logger.js"
import { buildAuthPlugins } from "./auth-plugins.js"
import { AUTH_CLIENT_ADDRESS_HEADER } from "./client-address.js"
import { cookieDomainSchema } from "./cookie-domain-schema.js"
import { booleanFromEnv } from "./mailer/bool-schema.js"
import { sendMail } from "./mailer/send-mail.js"
import { buildResetPasswordEmail } from "./mailer/templates/reset-password-email.js"
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
 */
export function createAuth() {
	const db = createDBClient()

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
	const verificationEnabled = authEnv.EMAIL_VERIFICATION_ENABLED || verificationRequired

	return betterAuth({
		database: (options: Parameters<ReturnType<typeof drizzleAdapter>>[0]) =>
			withSafeDatabaseErrors(
				drizzleAdapter(db, {
					provider: "pg",
					schema: {
						users,
						sessions,
						accounts,
						verifications,
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
			customStorage: rateLimitStorage,
			window: authEnv.AUTH_RATE_LIMIT_WINDOW,
			max: authEnv.AUTH_RATE_LIMIT_MAX,
			customRules: {
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
			afterEmailVerification: async user => {
				await emitAuthEvent({ type: "user.email_verified", userId: user.id })
			},
			sendVerificationEmail: async ({ user, token }) => {
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
			revokeSessionsOnPasswordReset: true,
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
					// eslint-disable-next-line no-console -- reset delivery failure is logged so the client response stays generic
					console.error("[mailer] password reset email failed:", err)
				}
			},
		},
		user: {
			additionalFields: {
				privacyNoticeVersion: { type: "string", required: false, input: true },
				privacyAcceptedAt: { type: "date", required: false, input: false, returned: false },
				accountType: { type: "string", required: false, input: false, defaultValue: "client" },
				profileCompletedAt: { type: "date", required: false, input: false },
				mustResetPassword: { type: "boolean", required: false, input: false, defaultValue: false },
				disabledAt: { type: "date", required: false, input: false, returned: false },
				deletedAt: { type: "date", required: false, input: false, returned: false },
			},
		},
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
			after: createAuthMiddleware(async ctx => {
				if (ctx.path !== "/reset-password") return
				const sessionUserId = ctx.context.session?.user?.id
				if (sessionUserId) {
					await db
						.update(users)
						.set({ mustResetPassword: false, updatedAt: new Date() })
						.where(eq(users.id, sessionUserId))
				}
			}),
		},
		databaseHooks: {
			user: {
				create: {
					before: async user => {
						const accepted = (user as Record<string, unknown>).privacyNoticeVersion
						if (accepted !== PRIVACY_NOTICE_VERSION) {
							throw new APIError("BAD_REQUEST", {
								message: "Please read and accept the privacy notice to create an account.",
							})
						}
						return { data: { ...user, privacyAcceptedAt: new Date() } }
					},
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
					/** ADM-1: Disabled and soft-deleted accounts cannot sign in. */
					before: async session => {
						const [account] = await db
							.select({
								disabledAt: users.disabledAt,
								deletedAt: users.deletedAt,
							})
							.from(users)
							.where(eq(users.id, session.userId))
						if (!account || account.disabledAt !== null || account.deletedAt !== null) {
							throw new APIError("FORBIDDEN", {
								message: "This account is disabled or no longer active.",
							})
						}
					},
					after: async session => {
						await emitAuthEvent({ type: "session.created", userId: session.userId })
					},
				},
			},
		},
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
		trustedOrigins: parseOriginList(authEnv.BETTER_AUTH_TRUSTED_ORIGINS),
		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			updateAge: 60 * 60 * 24, // 1 day
			cookieCache: { enabled: false },
		},
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ["google"],
				allowDifferentEmails: false,
			},
		},
		advanced: {
			ipAddress: {
				ipAddressHeaders: [AUTH_CLIENT_ADDRESS_HEADER],
			},
			trustedProxyHeaders: false,
			defaultCookieAttributes: {
				httpOnly: true,
				sameSite: "lax",
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
		plugins: buildAuthPlugins(isApiDocsEnabled(process.env.NODE_ENV, authEnv.ENABLE_API_DOCS)),
	})
}

type AuthInstance = ReturnType<typeof createAuth>

let _auth: AuthInstance | null = null

export function clearAuthCache(): void {
	_auth = null
}

export function getAuth(): AuthInstance {
	if (!_auth) {
		_auth = createAuth()
	}
	return _auth!
}

export type Session = ReturnType<typeof getAuth>["$Infer"]["Session"]