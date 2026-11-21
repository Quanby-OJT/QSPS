/**
 * Sign-in security Policies (AUTH-3).
 *
 * DOMAIN-MODEL keys `auth.lockout_threshold`, `auth.lockout_minutes` and
 * `auth.staff_password_max_age_days` are read through `PolicyService`. That
 * service arrives with ADM-6; until then the values come from env. ADM-6 plugs
 * in with {@link setAuthPolicyReader} (same late binding as the audit
 * listener), and changing a value there needs `settings.policies:manage`.
 *
 * Free of `createEnv()` so it can be tested without auth configuration.
 */

export interface AuthPolicies {
	/** Failed sign-ins for one email before it is locked. */
	lockoutThreshold: number
	/** How long a lock lasts, and the window failed attempts are counted in. */
	lockoutMinutes: number
	/** A staff password older than this must be changed at sign-in. */
	staffPasswordMaxAgeDays: number
}

/** A new staff password must differ from this many previous ones (TOR §II). */
export const PASSWORD_HISTORY_DEPTH = 5

export type AuthPolicyReader = () => Promise<Partial<AuthPolicies>>

let reader: AuthPolicyReader | null = null

/** ADM-6 registers `PolicyService` here. `null` goes back to the env defaults. */
export function setAuthPolicyReader(next: AuthPolicyReader | null): void {
	reader = next
}

/**
 * Current Policies: the registered reader's values over the env defaults. A
 * reader that fails falls back to the defaults, so a Policy outage never
 * switches the protection off.
 */
export async function readAuthPolicies(defaults: AuthPolicies): Promise<AuthPolicies> {
	if (!reader) return defaults
	try {
		const values = await reader()
		return {
			lockoutThreshold: positive(values.lockoutThreshold) ?? defaults.lockoutThreshold,
			lockoutMinutes: positive(values.lockoutMinutes) ?? defaults.lockoutMinutes,
			staffPasswordMaxAgeDays:
				positive(values.staffPasswordMaxAgeDays) ?? defaults.staffPasswordMaxAgeDays,
		}
	} catch (error) {
		// eslint-disable-next-line no-console -- Policy read failure is logged; the defaults still apply
		console.error(
			"[auth-policies] read failed, using defaults:",
			error instanceof Error ? error.message : String(error)
		)
		return defaults
	}
}

function positive(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whether a password set at `changedAt` (or, never changed, at account
 * creation) is past the maximum age at `now`.
 */
export function isPasswordExpired(
	changedAt: Date | null,
	createdAt: Date,
	maxAgeDays: number,
	now: Date = new Date()
): boolean {
	const since = changedAt ?? createdAt
	return now.getTime() - since.getTime() > maxAgeDays * DAY_MS
}