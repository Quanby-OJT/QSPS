/**
 * Version of the privacy notice shown at registration (Data Privacy Act,
 * RA 10173). The sign-up must send exactly this value; the account stores it
 * with the time it was accepted. Change it whenever the notice text changes,
 * so every stored consent points at the wording the client actually saw.
 */
export const PRIVACY_NOTICE_VERSION = "2026-11-16" as const

export type PrivacyNoticeVersion = typeof PRIVACY_NOTICE_VERSION

/**
 * Whether a client must accept the Privacy Notice before continuing: they have
 * no consent record, or accepted an older version than the current one.
 * Versions are ISO dates, so they compare as strings.
 */
export function privacyConsentRequired(
	acceptedVersion: string | null | undefined,
	currentVersion: string = PRIVACY_NOTICE_VERSION
): boolean {
	if (!acceptedVersion) return true
	return acceptedVersion < currentVersion
}
