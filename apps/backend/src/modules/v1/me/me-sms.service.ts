import { Injectable } from "@nestjs/common"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import {
	createSmsSender,
	matchesMobileCode,
	mobileCodeDigest,
	newMobileCode,
	normalizeSmsNumber,
	reserveSmsCode,
	SMS_CODE_TTL_MS,
	SMS_VERIFY_ATTEMPTS,
	SmsRateLimitError,
} from "@repo/auth/sms"
import type { SmsChannel, SmsSettings } from "@repo/contracts"
import { mobileVerificationChallenges, users } from "@repo/db/schema"

import { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"

const fields = {
	mobile: users.mobile,
	mobileVerifiedAt: users.mobileVerifiedAt,
	smsNotificationsEnabled: users.smsNotificationsEnabled,
	mfaOtpChannel: users.mfaOtpChannel,
	twoFactorEnabled: users.twoFactorEnabled,
}

/**
 * Mobile verification and SMS preferences (NTF-2, DOMAIN-MODEL.md `users`,
 * `mobile_verification_challenges`, `sms_code_limits`). Errors are oRPC
 * errors, so the client gets the right status and message.
 */
@Injectable()
export class MeSmsService {
	constructor(private readonly audit: AuditService) {}

	async get(userId: string): Promise<SmsSettings> {
		const [user] = await db.select(fields).from(users).where(eq(users.id, userId))
		if (!user) throw new ORPCError("NOT_FOUND", { message: "Account not found" })
		return {
			mobile: user.mobile,
			mobileVerifiedAt: user.mobileVerifiedAt,
			smsNotificationsEnabled: user.smsNotificationsEnabled === true,
			mfaOtpChannel: user.mfaOtpChannel === "sms" ? "sms" : "email",
			twoFactorEnabled: user.twoFactorEnabled === true,
		}
	}

	async requestCode(userId: string, input: string): Promise<{ ok: true }> {
		const mobile = normalizeSmsNumber(input)
		if (!mobile) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Enter a valid mobile number, like 09171234567 or +639171234567",
			})
		}
		const user = await this.get(userId)
		if (user.mfaOtpChannel === "sms" && user.mobile !== mobile) {
			throw new ORPCError("CONFLICT", {
				message: "Change sign-in codes to email before changing your mobile number",
			})
		}
		const secret = process.env.BETTER_AUTH_SECRET ?? ""
		try {
			await reserveSmsCode(db, secret, mobile, userId)
		} catch (error) {
			if (error instanceof SmsRateLimitError) {
				throw new ORPCError("TOO_MANY_REQUESTS", { message: error.message })
			}
			throw new ORPCError("SERVICE_UNAVAILABLE", { message: "SMS verification is unavailable" })
		}
		const code = newMobileCode()
		const expiresAt = new Date(Date.now() + SMS_CODE_TTL_MS)
		const challenge = {
			mobile,
			codeDigest: mobileCodeDigest(secret, userId, mobile, code),
			expiresAt,
			failedAttempts: 0,
		}
		await db.transaction(async tx => {
			const [current] = await tx
				.select(fields)
				.from(users)
				.where(eq(users.id, userId))
				.for("update")
			if (!current || (current.mfaOtpChannel === "sms" && current.mobile !== mobile)) {
				throw new ORPCError("CONFLICT", {
					message: "Mobile number cannot be changed while SMS sign-in is enabled",
				})
			}
			await tx
				.insert(mobileVerificationChallenges)
				.values({ userId, ...challenge })
				.onConflictDoUpdate({ target: mobileVerificationChallenges.userId, set: challenge })
			await this.audit.record(
				{
					domain: "account",
					action: "mobile.verification_requested",
					actorId: userId,
					targetType: "user",
					targetId: userId,
				},
				tx
			)
		})
		try {
			await createSmsSender().send(
				mobile,
				`Your QSPS mobile verification code is ${code}. Valid for 5 minutes. Do not share it.`
			)
		} catch {
			throw new ORPCError("SERVICE_UNAVAILABLE", {
				message: "The SMS code could not be sent. Please try again later.",
			})
		}
		return { ok: true }
	}

	async verifyCode(userId: string, code: string): Promise<SmsSettings> {
		const result = await db.transaction(async tx => {
			const [current] = await tx
				.select(fields)
				.from(users)
				.where(eq(users.id, userId))
				.for("update")
			if (!current) throw new ORPCError("NOT_FOUND", { message: "Account not found" })
			const [challenge] = await tx
				.select()
				.from(mobileVerificationChallenges)
				.where(eq(mobileVerificationChallenges.userId, userId))
				.for("update")
			if (
				!challenge ||
				challenge.expiresAt.getTime() <= Date.now() ||
				challenge.failedAttempts >= SMS_VERIFY_ATTEMPTS
			) {
				return false
			}
			if (
				!matchesMobileCode(
					challenge.codeDigest,
					mobileCodeDigest(process.env.BETTER_AUTH_SECRET ?? "", userId, challenge.mobile, code)
				)
			) {
				await tx
					.update(mobileVerificationChallenges)
					.set({ failedAttempts: challenge.failedAttempts + 1 })
					.where(eq(mobileVerificationChallenges.userId, userId))
				return false
			}
			if (current.mfaOtpChannel === "sms" && current.mobile !== challenge.mobile) return false
			const changed = current.mobile !== challenge.mobile
			await tx
				.update(users)
				.set({
					mobile: challenge.mobile,
					mobileVerifiedAt: new Date(),
					updatedAt: new Date(),
					...(changed ? { smsNotificationsEnabled: false } : {}),
				})
				.where(eq(users.id, userId))
			await tx
				.delete(mobileVerificationChallenges)
				.where(eq(mobileVerificationChallenges.userId, userId))
			await this.audit.record(
				{
					domain: "account",
					action: "mobile.verified",
					actorId: userId,
					targetType: "user",
					targetId: userId,
				},
				tx
			)
			return true
		})
		if (!result) {
			throw new ORPCError("BAD_REQUEST", { message: "Invalid or expired verification code" })
		}
		return this.get(userId)
	}

	async updatePreferences(
		userId: string,
		input: { smsNotificationsEnabled: boolean; mfaOtpChannel: SmsChannel },
		passwordConfirmed: boolean
	): Promise<SmsSettings> {
		await db.transaction(async tx => {
			const [current] = await tx
				.select(fields)
				.from(users)
				.where(eq(users.id, userId))
				.for("update")
			if (!current) throw new ORPCError("NOT_FOUND", { message: "Account not found" })
			if (input.mfaOtpChannel !== current.mfaOtpChannel && !passwordConfirmed) {
				throw new ORPCError("FORBIDDEN", {
					message: "Confirm your password to change where sign-in codes are sent",
				})
			}
			if (
				(input.smsNotificationsEnabled || input.mfaOtpChannel === "sms") &&
				(!current.mobileVerifiedAt || !current.mobile || !normalizeSmsNumber(current.mobile))
			) {
				throw new ORPCError("BAD_REQUEST", { message: "Verify your mobile number first" })
			}
			if (input.mfaOtpChannel === "sms" && !current.twoFactorEnabled) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Set up two-factor authentication first",
				})
			}
			await tx
				.update(users)
				.set({ ...input, updatedAt: new Date() })
				.where(eq(users.id, userId))
			await this.audit.record(
				{
					domain: "account",
					action: "sms.preferences_updated",
					actorId: userId,
					targetType: "user",
					targetId: userId,
				},
				tx
			)
		})
		return this.get(userId)
	}
}
