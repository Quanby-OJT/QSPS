import { twoFactorClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

import { getAuthUrl } from "./lib/utils"

/** AUTH-2: where a sign-in that needs a second factor continues. */
export const TWO_FACTOR_CHALLENGE_PATH = "/two-factor"

/**
 * Better Auth client for React components.
 * Provides hooks like useSession, signIn, signOut, etc.
 *
 * Points to the NestJS backend for auth operations.
 *
 * AUTH-2: the two-factor plugin adds `authClient.twoFactor.*` (enable,
 * disable, verifyTotp, sendOtp, verifyOtp, verifyBackupCode,
 * generateBackupCodes). When a password sign-in still needs a code, the login
 * hook sends the user to the challenge page with an in-app navigation, so the
 * home page's sign in modal becomes the code modal. The plugin itself does not
 * navigate: a full page load here would run first and skip the modal. The old
 * `as ReturnType<typeof createAuthClient>` cast is gone: it would hide the
 * plugin's methods from TypeScript.
 */
export const authClient = createAuthClient({
	baseURL: getAuthUrl(),
	plugins: [twoFactorClient()],
})
