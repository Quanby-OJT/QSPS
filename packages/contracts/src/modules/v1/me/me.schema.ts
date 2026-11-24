import { z } from "zod"

import { PRIVACY_NOTICE_VERSION } from "../../../common/privacy-notice.js"
import { PermissionNameSchema } from "../rbac/rbac.catalog.js"

export const MePermissionsSchema = z.object({
	roles: z.array(z.string()),
	permissions: z.array(PermissionNameSchema),
})

export type MePermissions = z.infer<typeof MePermissionsSchema>

// ============================================================================
// CLIENT PROFILE (AUTH-1)
// ============================================================================

/**
 * Gender choices offered in the form. TOR §VIII.2 requires the field to accept
 * all genders, so these are suggestions only: any other text is accepted too.
 */
export const GENDER_OPTIONS = ["Female", "Male", "Non-binary", "Prefer not to say"] as const

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in YYYY-MM-DD, not in the future, not before 1900. */
function isValidBirthDate(value: string): boolean {
	if (!ISO_DATE.test(value)) return false
	const date = new Date(`${value}T00:00:00Z`)
	if (Number.isNaN(date.getTime())) return false
	// Rejects dates JavaScript silently rolls over, such as 2026-02-30.
	if (date.toISOString().slice(0, 10) !== value) return false
	return date.getUTCFullYear() >= 1900 && date.getTime() <= Date.now()
}

/** What the client fills in on first sign-in, and can edit later. */
export const UpdateClientProfileSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
	/** Spaces and dashes are removed; then 10–15 digits, optionally starting with +. */
	mobile: z
		.string()
		.trim()
		.transform(value => value.replace(/[\s-]/g, ""))
		.pipe(z.string().regex(/^\+?\d{10,15}$/, "Enter a valid mobile number")),
	birthDate: z.string().trim().refine(isValidBirthDate, "Enter a valid birth date (YYYY-MM-DD)"),
	nationality: z
		.string()
		.trim()
		.min(2, "Nationality is required")
		.max(60, "Nationality is too long"),
	/** Free text or one of {@link GENDER_OPTIONS}. */
	gender: z.string().trim().min(1, "Gender is required").max(50, "Gender is too long"),
})

export const ClientProfileSchema = z.object({
	name: z.string(),
	/** Null for a mobile-only walk-in account (show "No email"). */
	email: z.string().nullable(),
	mobile: z.string().nullable(),
	/** YYYY-MM-DD */
	birthDate: z.string().nullable(),
	nationality: z.string().nullable(),
	gender: z.string().nullable(),
	/** Set the first time the profile is completed; null keeps the portal closed. */
	profileCompletedAt: z.coerce.date().nullable(),
	isComplete: z.boolean(),
	/** No consent on record, or an older Privacy Notice than the current one (PRC-2b). */
	privacyConsentRequired: z.boolean(),
})

/** Accept the Privacy Notice now shown; it must be the current version. */
export const AcceptPrivacyNoticeSchema = z.object({
	privacyNoticeVersion: z.literal(PRIVACY_NOTICE_VERSION, {
		error: "Please read and accept the current Privacy Notice",
	}),
})

export type AcceptPrivacyNoticeInput = z.infer<typeof AcceptPrivacyNoticeSchema>
export type UpdateClientProfileInput = z.infer<typeof UpdateClientProfileSchema>
export type ClientProfile = z.infer<typeof ClientProfileSchema>

// ============================================================================
// MOBILE NUMBER AND SMS (NTF-2)
// ============================================================================

/** Where the AUTH-2 one-time sign-in code is sent. */
export const SmsChannelSchema = z.enum(["email", "sms"])

export const SmsSettingsSchema = z.object({
	mobile: z.string().nullable(),
	/** Set when the client confirms a code sent to `mobile`; null means not verified. */
	mobileVerifiedAt: z.coerce.date().nullable(),
	smsNotificationsEnabled: z.boolean(),
	mfaOtpChannel: SmsChannelSchema,
	twoFactorEnabled: z.boolean(),
})

export const RequestSmsCodeSchema = z.object({
	mobile: z.string().trim().min(10, "Enter your mobile number").max(30, "That number is too long"),
})

export const VerifySmsCodeSchema = z.object({
	code: z
		.string()
		.trim()
		.regex(/^\d{6}$/, "Enter the 6-digit code"),
})

export const UpdateSmsPreferencesSchema = z.object({
	smsNotificationsEnabled: z.boolean(),
	mfaOtpChannel: SmsChannelSchema,
	/** Required when `mfaOtpChannel` changes. */
	password: z.string().max(256).optional(),
})

export const SmsCodeSentSchema = z.object({ ok: z.literal(true) })

export type SmsChannel = z.infer<typeof SmsChannelSchema>
export type SmsSettings = z.infer<typeof SmsSettingsSchema>
export type RequestSmsCodeInput = z.infer<typeof RequestSmsCodeSchema>
export type VerifySmsCodeInput = z.infer<typeof VerifySmsCodeSchema>
export type UpdateSmsPreferencesInput = z.infer<typeof UpdateSmsPreferencesSchema>
