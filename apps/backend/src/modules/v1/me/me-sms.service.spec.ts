import { createHmac, randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"

import { createSmsSender, reserveSmsCode, SMS_CODE_WINDOW_MS } from "@repo/auth/sms"
import { mobileVerificationChallenges, smsCodeLimits, users } from "@repo/db/schema"

import type { AuditService } from "@/common/audit/audit.service"
import { db } from "@/common/database/database.client"
import { bindDbBackedTests } from "@/testing/db-ready"

import { MeSmsService } from "./me-sms.service"

// @orpc/server is ESM-only; the service only needs its error class.
jest.mock("@orpc/server", () => ({
	ORPCError: class ORPCError extends Error {
		constructor(
			public readonly code: string,
			options: { message: string }
		) {
			super(options.message)
		}
	},
}))
jest.mock("@repo/auth/sms", () => ({
	...jest.requireActual("@repo/auth/sms"),
	createSmsSender: jest.fn(),
}))

describe("NTF-2 mobile verification", () => {
	const tests = bindDbBackedTests({
		label: "ntf2",
		relations: ["users", "mobile_verification_challenges", "sms_code_limits"],
		database: db,
	})
	const id = `ntf2-${randomUUID()}`
	const mobile = `+639${String(process.pid).padStart(9, "0").slice(-9)}`
	const secret = process.env.BETTER_AUTH_SECRET ?? ""
	const rateKeys = [
		["sms-rate:number", mobile],
		["sms-rate:user", id],
	].map(parts => createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex"))
	const send = jest.fn().mockResolvedValue(undefined)
	const audit = { record: jest.fn().mockResolvedValue(undefined) }
	const service = new MeSmsService(audit as unknown as AuditService)

	beforeAll(async () => {
		await tests.probe()
		if (!tests.ready) return
		await db
			.insert(users)
			.values({ id, name: "SMS test user", email: `${id}@example.test`, twoFactorEnabled: true })
	})

	beforeEach(async () => {
		jest.clearAllMocks()
		;(createSmsSender as jest.Mock).mockReturnValue({ send })
		if (!tests.ready) return
		await db.delete(smsCodeLimits).where(inArray(smsCodeLimits.key, rateKeys))
		await db.delete(mobileVerificationChallenges).where(eq(mobileVerificationChallenges.userId, id))
		await db
			.update(users)
			.set({
				mobile: null,
				mobileVerifiedAt: null,
				smsNotificationsEnabled: false,
				mfaOtpChannel: "email",
			})
			.where(eq(users.id, id))
	})

	afterAll(async () => {
		if (tests.ready) {
			await db
				.delete(mobileVerificationChallenges)
				.where(eq(mobileVerificationChallenges.userId, id))
			await db.delete(smsCodeLimits).where(inArray(smsCodeLimits.key, rateKeys))
			await db.delete(users).where(eq(users.id, id))
		}
		if (tests.connected) await db.$client.end()
	})

	const itDb = tests.itDb

	itDb(
		"requires verification, consumes the code once, and requires password confirmation to select SMS MFA",
		async () => {
			await expect(
				service.updatePreferences(
					id,
					{ smsNotificationsEnabled: true, mfaOtpChannel: "email" },
					false
				)
			).rejects.toThrow("Verify your mobile")
			await service.requestCode(id, mobile)
			const body = send.mock.calls[0]?.[1] as string
			const code = body.match(/\b\d{6}\b/)?.[0]
			if (!code) throw new Error("Mock provider did not receive a code")
			const [challenge] = await db
				.select()
				.from(mobileVerificationChallenges)
				.where(eq(mobileVerificationChallenges.userId, id))
			expect(challenge?.codeDigest).not.toBe(code)
			await expect(service.verifyCode(id, code)).resolves.toMatchObject({
				mobile,
				mobileVerifiedAt: expect.any(Date),
			})
			await expect(service.verifyCode(id, code)).rejects.toThrow("Invalid or expired")
			await expect(
				service.updatePreferences(
					id,
					{ smsNotificationsEnabled: true, mfaOtpChannel: "sms" },
					false
				)
			).rejects.toThrow("Confirm your password")
			await expect(
				service.updatePreferences(id, { smsNotificationsEnabled: true, mfaOtpChannel: "sms" }, true)
			).resolves.toMatchObject({ smsNotificationsEnabled: true, mfaOtpChannel: "sms" })
		}
	)

	itDb("refuses a number that is not a valid mobile number", async () => {
		await expect(service.requestCode(id, "12345")).rejects.toMatchObject({ code: "BAD_REQUEST" })
		expect(send).not.toHaveBeenCalled()
	})

	itDb("limits repeated sends across instances and reopens after the cooldown", async () => {
		const now = new Date()
		for (let i = 0; i < 3; i++) await reserveSmsCode(db, secret, mobile, id, now)
		await expect(reserveSmsCode(db, secret, mobile, id, now)).rejects.toThrow(
			"Too many SMS code requests"
		)
		await expect(
			reserveSmsCode(db, secret, mobile, id, new Date(now.getTime() + SMS_CODE_WINDOW_MS))
		).resolves.toBeUndefined()
	})
})
