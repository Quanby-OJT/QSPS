/**
 * Account events the host process records in its audit trail (AUTH-1).
 *
 * DOMAIN-MODEL §6: only the backend's `AuditService` writes `audit_log`. This
 * package cannot depend on the backend, so — like `setAuthRateLimitStorage` —
 * it exposes a slot the backend fills at startup with `setAuthEventListener`,
 * and Better Auth's hooks call `emitAuthEvent`. With nothing registered (the
 * CLI, the test suites) events are dropped.
 *
 * Events carry ids only. Email addresses, IP addresses and device details stay
 * out until FND-3 decides how the audit trail stores them.
 */
export type AuthEvent =
	| { type: "user.registered"; userId: string }
	| { type: "user.email_verified"; userId: string }
	| { type: "session.created"; userId: string }

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
