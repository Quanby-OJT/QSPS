import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import {
	PRIVACY_NOTICE_VERSION,
	privacyConsentRequired,
	type AcceptPrivacyNoticeInput,
	type ClientProfile,
	type UpdateClientProfileInput,
} from "@repo/contracts"
import { users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { displayEmail } from "@/common/users/placeholder-email"

/** Audit domain for a user's own account changes (AUTH-1). */
export const AUDIT_DOMAIN_ACCOUNT = "account"

const profileColumns = {
	name: users.name,
	email: users.email,
	mobile: users.mobile,
	birthDate: users.birthDate,
	nationality: users.nationality,
	gender: users.gender,
	profileCompletedAt: users.profileCompletedAt,
	privacyNoticeVersion: users.privacyNoticeVersion,
}

const EDITABLE_FIELDS = ["name", "mobile", "birthDate", "nationality", "gender"] as const

type ProfileRow = {
	name: string
	email: string
	mobile: string | null
	birthDate: string | null
	nationality: string | null
	gender: string | null
	profileCompletedAt: Date | null
	privacyNoticeVersion: string | null
}

function toProfile({ privacyNoticeVersion, email, ...row }: ProfileRow): ClientProfile {
	return {
		...row,
		// A mobile-only walk-in account's placeholder is never shown (PRC-2b).
		email: displayEmail(email),
		isComplete: row.profileCompletedAt !== null,
		privacyConsentRequired: privacyConsentRequired(privacyNoticeVersion, PRIVACY_NOTICE_VERSION),
	}
}

/**
 * The signed-in user's own profile (AUTH-1).
 *
 * `profileCompletedAt` is set the first time every field is saved and never
 * cleared afterwards: it is the gate the web checks before opening the portal.
 */
@Injectable()
export class MeProfileService {
	constructor(private readonly auditService: AuditService) {}

	async getProfile(userId: string): Promise<ClientProfile> {
		const [row] = await db.select(profileColumns).from(users).where(eq(users.id, userId))
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Account not found" })
		return toProfile(row)
	}

	/**
	 * Save the profile and its audit entry in one transaction, so a profile
	 * change can never commit unrecorded. The entry names the fields that
	 * changed, not their values: the audit log is read by staff and must not
	 * become a second copy of clients' personal data.
	 */
	async updateProfile(userId: string, input: UpdateClientProfileInput): Promise<ClientProfile> {
		return db.transaction(async tx => {
			const [current] = await tx
				.select({ ...profileColumns, mfaOtpChannel: users.mfaOtpChannel })
				.from(users)
				.where(eq(users.id, userId))
				.for("update")
			if (!current) throw new ORPCError("NOT_FOUND", { message: "Account not found" })

			const mobileChanged = current.mobile !== input.mobile
			if (mobileChanged && current.mfaOtpChannel === "sms")
				throw new ORPCError("CONFLICT", {
					message:
						"Switch sign-in codes to email in Account settings before changing your mobile number.",
				})
			const now = new Date()
			const [row] = await tx
				.update(users)
				.set({
					name: input.name,
					mobile: input.mobile,
					...(mobileChanged ? { mobileVerifiedAt: null, smsNotificationsEnabled: false } : {}),
					birthDate: input.birthDate,
					nationality: input.nationality,
					gender: input.gender,
					updatedAt: now,
					profileCompletedAt: current.profileCompletedAt ?? now,
				})
				.where(eq(users.id, userId))
				.returning(profileColumns)
			if (!row) throw new ORPCError("NOT_FOUND", { message: "Account not found" })

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_ACCOUNT,
					action: current.profileCompletedAt ? "profile.update" : "profile.complete",
					actorId: userId,
					targetType: "user",
					targetId: userId,
					newValue: {
						changedFields: EDITABLE_FIELDS.filter(field => current[field] !== input[field]),
					},
				},
				tx
			)

			return toProfile(row)
		})
	}

	/**
	 * PRC-2b: the user accepts the Privacy Notice now shown, because they had no
	 * consent on record or an older version. Saved with its audit entry in one
	 * transaction; the entry holds the versions, no personal data.
	 */
	async acceptPrivacyNotice(
		userId: string,
		input: AcceptPrivacyNoticeInput,
		now: Date = new Date()
	): Promise<ClientProfile> {
		if (input.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Please read and accept the current Privacy Notice",
			})
		}
		return db.transaction(async tx => {
			const [current] = await tx
				.select({ privacyNoticeVersion: users.privacyNoticeVersion })
				.from(users)
				.where(eq(users.id, userId))
				.for("update")
			if (!current) throw new ORPCError("NOT_FOUND", { message: "Account not found" })

			const [row] = await tx
				.update(users)
				.set({
					privacyNoticeVersion: input.privacyNoticeVersion,
					privacyAcceptedAt: now,
					updatedAt: now,
				})
				.where(eq(users.id, userId))
				.returning(profileColumns)
			if (!row) throw new ORPCError("NOT_FOUND", { message: "Account not found" })

			await this.auditService.record(
				{
					domain: AUDIT_DOMAIN_ACCOUNT,
					action: "privacy_notice.accept",
					actorId: userId,
					targetType: "user",
					targetId: userId,
					oldValue: { privacyNoticeVersion: current.privacyNoticeVersion },
					newValue: { privacyNoticeVersion: input.privacyNoticeVersion },
				},
				tx
			)

			return toProfile(row)
		})
	}
}
