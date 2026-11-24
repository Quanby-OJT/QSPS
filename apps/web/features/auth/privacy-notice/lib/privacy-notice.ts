import { privacyConsentRequired } from "@repo/contracts"

/**
 * The Privacy Notice wording (Data Privacy Act, RA 10173), shown at
 * registration, at the walk-in counter and at the sign-in prompt. Changing it
 * means raising PRIVACY_NOTICE_VERSION in @repo/contracts, so every client is
 * asked to accept the new wording.
 */
export const PRIVACY_NOTICE_TEXT =
	"The Bureau of Quarantine collects your name, email, mobile number, birth date, nationality, and gender to create your account, schedule and process the services you book, and issue your documents, as allowed by the Data Privacy Act of 2012 (RA 10173). Your data is kept only as long as BOQ's retention policy requires and is used only for the services you request."

/** Where a client accepts the Privacy Notice before the portal opens. */
export const PRIVACY_NOTICE_PATH = "/privacy-notice"

/**
 * PRC-2b: where to send a signed-in user before the portal, or null. Only
 * clients are asked, and only when they have no consent on record or the
 * current notice is newer than the one they accepted.
 */
export function privacyNoticeRedirect(user: {
	isClient: boolean
	privacyNoticeVersion?: string | null
}): string | null {
	if (!user.isClient) return null
	return privacyConsentRequired(user.privacyNoticeVersion) ? PRIVACY_NOTICE_PATH : null
}
