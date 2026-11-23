import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import type { ClientProfile, UpdateClientProfileInput } from "@repo/contracts"
import { users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

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
}

function toProfile(row: ProfileRow): ClientProfile {
	return { ...row, isComplete: row.profileCompletedAt !== null }
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
}
