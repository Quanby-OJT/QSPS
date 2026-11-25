/**
 * PRC-2b: a walk-in client with only a mobile number. Better Auth needs an
 * email on every account, so the account stores `<userId>@no-email.invalid`.
 * `.invalid` is reserved (RFC 2606) and can never receive mail; the mailer
 * skips it (`sendMail` in @repo/auth).
 *
 * The placeholder is never shown as an email: display responses carry null
 * (or {@link NO_EMAIL_LABEL} in printed text).
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "no-email.invalid"

/** What screens and printouts show instead of the placeholder. */
export const NO_EMAIL_LABEL = "No email"

export function placeholderEmail(userId: string): string {
	return `${userId}@${PLACEHOLDER_EMAIL_DOMAIN}`
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
	return !!email && email.trim().toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)
}

/** The email to show, or null when the account has only the placeholder. */
export function displayEmail(email: string): string | null {
	return isPlaceholderEmail(email) ? null : email
}
