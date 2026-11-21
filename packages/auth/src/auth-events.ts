/**
 * Account events the host process records in its audit trail (AUTH-1, AUTH-2, AUTH-3).
 *
 * DOMAIN-MODEL §6: only the backend's `AuditService` writes `audit_log`. This
 * package cannot depend on the backend, so — like `setAuthRateLimitStorage` —
 * it exposes a slot the backend fills at startup with `setAuthEventListener`,
 * and Better Auth's hooks call `emitAuthEvent`. With nothing registered (the
 * CLI, the test suites) events are dropped.
 *
 * Events carry ids only, never codes, secrets or email addresses. The IP
 * address and device come from the backend's request context (FND-3).
 */

/** Which second factor was used (AUTH-2). */
export type MfaMethod = "totp" | "otp" | "backup_code"

export type AuthEvent =
	| { type: "user.registered"; userId: string }
	| { type: "user.email_verified"; userId: string }
	| { type: "session.created"; userId: string }
	// AUTH-2: second-factor lifecycle and challenge results.
	| { type: "mfa.enabled"; userId: string }
	| { type: "mfa.disabled"; userId: string }
	| { type: "mfa.verified"; userId: string; method: MfaMethod }
	| { type: "mfa.failed"; userId: string; method: MfaMethod }
	/** A code was submitted while the challenge is locked after repeated failures. */
	| { type: "mfa.locked"; userId: string; method: MfaMethod }
	/** A settings change the rules refuse, e.g. staff turning MFA off. */
	| { type: "mfa.refused"; userId: string; reason: string }
	// AUTH-3: brute-force protection and password rotation.
	/** A sign-in with the wrong password for an existing account. */
	| { type: "sign_in.failed"; userId: string }
	/** A sign-in attempted while the account is locked. */
	| { type: "sign_in.locked"; userId: string }
	/** Repeated failures locked the account. */
	| { type: "account.locked"; userId: string; attempts: number; minutes: number }
	/** A staff password reached the maximum age; it must be changed before anything else. */
	| { type: "password.expired"; userId: string }
	/** A password was set or changed. */
	| { type: "password.changed"; userId: string }
	/** A new staff password matched one of the recent ones and was refused. */
	| { type: "password.reuse_refused"; userId: string }

export type AuthEventListener = (event: AuthEvent) => Promise<void> | void

let listener: AuthEventListener | null = null

/** Register the audit listener, or pass `null` to stop recording (on shutdown). */
export function setAuthEventListener(next: AuthEventListener | null): void {
	listener = next
}

/**
 * Hand an event to the registered listener.
 *
 * A failed audit write is logged, never thrown: it must not turn a successful
 * sign-up, verification or sign-in into an error for the user, and Better
 * Auth's hooks run after the change is already saved.
 */
export async function emitAuthEvent(event: AuthEvent): Promise<void> {
	if (!listener) return
	try {
		await listener(event)
	} catch (error) {
		// eslint-disable-next-line no-console -- audit failure is logged server-side; the auth flow carries on
		console.error(
			`[auth-events] audit write failed for ${event.type}:`,
			error instanceof Error ? error.message : error
		)
	}
}