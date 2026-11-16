/**
 * Version of the privacy notice shown at registration (Data Privacy Act,
 * RA 10173). The sign-up must send exactly this value; the account stores it
 * with the time it was accepted. Change it whenever the notice text changes,
 * so every stored consent points at the wording the client actually saw.
 */
export const PRIVACY_NOTICE_VERSION = "2026-11-16" as const

export type PrivacyNoticeVersion = typeof PRIVACY_NOTICE_VERSION
