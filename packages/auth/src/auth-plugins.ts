import { openAPI, twoFactor } from "better-auth/plugins"

/** Name shown next to the account in authenticator apps (AUTH-2). */
export const MFA_ISSUER = "QSPS · Bureau of Quarantine"

/** Minutes an emailed one-time code stays valid. */
export const MFA_EMAIL_CODE_MINUTES = 5

export interface AuthPluginOptions {
	/**
	 * Delivers an emailed one-time sign-in code (AUTH-2). `createAuth` passes
	 * the real mailer. Left out in tests and the schema CLI, where no code is
	 * ever sent.
	 */
	sendTwoFactorOtp?: (input: { email: string; otp: string }) => Promise<void>
}

/**
 * Plugins for the shared Better Auth instance.
 *
 * - Two-factor (AUTH-2, TOR §VIII.1–2): authenticator app (TOTP), emailed
 *   one-time code, and single-use recovery codes. Always registered. Whether
 *   a user must use it (staff) or may (clients) is decided by the app, not
 *   the plugin.
 * - The openAPI reference is a debug surface. It is registered only when docs
 *   are enabled, and `createAuth` passes `isApiDocsEnabled(...)` so the plugin
 *   follows the same rule as the backend.
 *
 * Kept out of `config.ts` so the list can be asserted without a database
 * connection or `createEnv()`.
 */
export function buildAuthPlugins(docsEnabled: boolean, options: AuthPluginOptions = {}) {
	return [
		twoFactor({
			issuer: MFA_ISSUER,
			otpOptions: {
				period: MFA_EMAIL_CODE_MINUTES,
				sendOTP: async ({ user, otp }) => {
					await options.sendTwoFactorOtp?.({ email: user.email, otp })
				},
			},
			backupCodeOptions: { amount: 10, length: 10 },
			// TOR §VIII / AUTH-2: five wrong codes in a row lock the challenge
			// for a cooling-off period. Counts across factors; a correct code resets it.
			accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
		}),
		...(docsEnabled ? [openAPI({ path: "/reference" })] : []),
	]
}
