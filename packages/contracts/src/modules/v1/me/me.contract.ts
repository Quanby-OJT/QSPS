import { oc } from "@orpc/contract"

import {
	AcceptPrivacyNoticeSchema,
	ClientProfileSchema,
	MePermissionsSchema,
	RequestSmsCodeSchema,
	SmsCodeSentSchema,
	SmsSettingsSchema,
	UpdateClientProfileSchema,
	UpdateSmsPreferencesSchema,
	VerifySmsCodeSchema,
} from "./me.schema.js"

export const meContract = {
	permissions: oc
		.route({
			method: "GET",
			path: "/me/permissions",
			summary: "Get current user permissions",
			description: "Return the current user's role names and effective permission names.",
			tags: ["Me"],
		})
		.output(MePermissionsSchema),

	profile: oc
		.route({
			method: "GET",
			path: "/me/profile",
			summary: "Get my profile",
			description: "Return the signed-in user's profile and whether it is complete.",
			tags: ["Me"],
		})
		.output(ClientProfileSchema),

	updateProfile: oc
		.route({
			method: "PUT",
			path: "/me/profile",
			summary: "Complete or update my profile",
			description:
				"Save name, mobile, birth date, nationality and gender. The first complete save opens the portal. Requires `account.profile:manage`.",
			tags: ["Me"],
		})
		.input(UpdateClientProfileSchema)
		.output(ClientProfileSchema),

	acceptPrivacyNotice: oc
		.route({
			method: "POST",
			path: "/me/privacy-notice",
			summary: "Accept the current Privacy Notice",
			description:
				"Records that the signed-in user accepted the Privacy Notice version now shown, and when. Asked at sign-in when there is no consent on record or the notice is newer than the one accepted (PRC-2b). Needs only a session.",
			tags: ["Me"],
		})
		.input(AcceptPrivacyNoticeSchema)
		.output(ClientProfileSchema),

	smsSettings: oc
		.route({
			method: "GET",
			path: "/me/sms",
			summary: "Get my mobile and SMS settings",
			description:
				"The mobile number, whether it is verified, SMS notifications on or off, and where sign-in codes go (NTF-2). Requires `account.profile:manage`.",
			tags: ["Me"],
		})
		.output(SmsSettingsSchema),

	requestSmsCode: oc
		.route({
			method: "POST",
			path: "/me/sms/request-code",
			summary: "Text a verification code to a mobile number",
			description:
				"Sends a 6-digit code, valid for 5 minutes. At most three sends per number and per account in 15 minutes. Requires `account.profile:manage`.",
			tags: ["Me"],
		})
		.input(RequestSmsCodeSchema)
		.output(SmsCodeSentSchema),

	verifySmsCode: oc
		.route({
			method: "POST",
			path: "/me/sms/verify-code",
			summary: "Verify my mobile number",
			description:
				"Checks the code once. A correct code verifies the number; a new number turns SMS notifications off. Requires `account.profile:manage`.",
			tags: ["Me"],
		})
		.input(VerifySmsCodeSchema)
		.output(SmsSettingsSchema),

	updateSmsPreferences: oc
		.route({
			method: "PUT",
			path: "/me/sms/preferences",
			summary: "Save my SMS preferences",
			description:
				"Turns SMS notifications on or off and chooses where sign-in codes go. Both need a verified number; changing the code channel needs the password. Requires `account.profile:manage`.",
			tags: ["Me"],
		})
		.input(UpdateSmsPreferencesSchema)
		.output(SmsSettingsSchema),
}
