import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	Injectable,
	NotFoundException,
	ServiceUnavailableException,
} from "@nestjs/common"
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

@Injectable()
export class MeSmsService {
	constructor(private readonly audit: AuditService) {}

	async get(userId: string) {
		const [user] = await db.select(fields).from(users).where(eq(users.id, userId))
		if (!user) throw new NotFoundException("Account not found")
		return user
	}

	async requestCode(userId: string, input: string) {
		const mobile = normalizeSmsNumber(input)
		if (!mobile) throw new BadRequestException("Enter a valid mobile number with country code")
		const user = await this.get(userId)
		if (user.mfaOtpChannel === "sms" && user.mobile !== mobile)
			throw new ConflictException(
				"Change sign-in codes to email before changing your mobile number"
			)
		const secret = process.env.BETTER_AUTH_SECRET ?? ""
		try {
			await reserveSmsCode(db, secret, mobile, userId)
		} catch (error) {
			if (error instanceof SmsRateLimitError) throw new HttpException(error.message, 429)
			throw new ServiceUnavailableException("SMS verification is unavailable")
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
			if (!current || (current.mfaOtpChannel === "sms" && current.mobile !== mobile))
				throw new ConflictException("Mobile number cannot be changed while SMS sign-in is enabled")
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
			throw new ServiceUnavailableException(
				"The SMS code could not be sent. Please try again later."
			)
		}
		return { ok: true }
	}

	async verifyCode(userId: string, code: string) {
		const result = await db.transaction(async tx => {
			const [current] = await tx
				.select(fields)
				.from(users)
				.where(eq(users.id, userId))
				.for("update")
			if (!current) throw new NotFoundException("Account not found")
			const [challenge] = await tx
				.select()
				.from(mobileVerificationChallenges)
				.where(eq(mobileVerificationChallenges.userId, userId))
				.for("update")
			if (
				!challenge ||
				challenge.expiresAt.getTime() <= Date.now() ||
				challenge.failedAttempts >= SMS_VERIFY_ATTEMPTS
			)
				return false
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
		if (!result) throw new BadRequestException("Invalid or expired verification code")
		return this.get(userId)
	}

	async updatePreferences(
		userId: string,
		input: { smsNotificationsEnabled: boolean; mfaOtpChannel: "email" | "sms" },
		passwordConfirmed: boolean
	) {
		await db.transaction(async tx => {
			const [current] = await tx
				.select(fields)
				.from(users)
				.where(eq(users.id, userId))
				.for("update")
			if (!current) throw new NotFoundException("Account not found")
			if (input.mfaOtpChannel !== current.mfaOtpChannel && !passwordConfirmed)
				throw new ForbiddenException("Confirm your password to change the sign-in code channel")
			if (
				(input.smsNotificationsEnabled || input.mfaOtpChannel === "sms") &&
				(!current.mobileVerifiedAt || !current.mobile || !normalizeSmsNumber(current.mobile))
			)
				throw new BadRequestException("Verify your mobile number first")
			if (input.mfaOtpChannel === "sms" && !current.twoFactorEnabled)
				throw new BadRequestException("Set up two-factor authentication first")
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
