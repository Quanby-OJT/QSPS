import { createHmac, randomInt, timingSafeEqual } from "node:crypto"
import { eq } from "drizzle-orm"

import type { DBClient } from "@repo/db/client"
import { smsCodeLimits } from "@repo/db/schema"

import { HttpSmsSender, type SmsSender } from "./sms/adapters/http-sms.sender.js"

export type { SmsSender }
export const SMS_CODE_TTL_MS = 5 * 60_000
export const SMS_CODE_LIMIT = 3
export const SMS_CODE_WINDOW_MS = 15 * 60_000
export const SMS_VERIFY_ATTEMPTS = 5

export class SmsRateLimitError extends Error {
	constructor() {
		super("Too many SMS code requests. Please try again in 15 minutes.")
	}
}

/** E.164; also accept the Philippine local 09... and 63... formats. */
export function normalizeSmsNumber(input: string): string | null {
	const compact = input.trim().replace(/[\s()-]/g, "")
	const number = /^09\d{9}$/.test(compact)
		? `+63${compact.slice(1)}`
		: /^639\d{9}$/.test(compact)
			? `+${compact}`
			: compact
	return /^\+[1-9]\d{9,14}$/.test(number) ? number : null
}

function digest(secret: string, values: string[]): string {
	if (!secret) throw new Error("SMS signing secret is unavailable")
	return createHmac("sha256", secret).update(JSON.stringify(values)).digest("hex")
}

export function smsDestinationKey(secret: string, mobile: string): string {
	return digest(secret, ["sms-destination", mobile])
}

export function mobileCodeDigest(
	secret: string,
	userId: string,
	mobile: string,
	code: string
): string {
	return digest(secret, ["mobile-verification", userId, mobile, code])
}

export function matchesMobileCode(expected: string, actual: string): boolean {
	const left = Buffer.from(expected, "hex")
	const right = Buffer.from(actual, "hex")
	return left.length === 32 && right.length === 32 && timingSafeEqual(left, right)
}

export function newMobileCode(): string {
	return randomInt(0, 1_000_000).toString().padStart(6, "0")
}

/** Reserve before sending: failure still counts; rows are locked across workers. */
export async function reserveSmsCode(
	db: DBClient,
	secret: string,
	mobile: string,
	userId: string,
	now = new Date()
): Promise<void> {
	const keys = [
		digest(secret, ["sms-rate:number", mobile]),
		digest(secret, ["sms-rate:user", userId]),
	].sort()
	await db.transaction(async tx => {
		for (const key of keys) {
			await tx
				.insert(smsCodeLimits)
				.values({ key, windowStartedAt: now, count: 0 })
				.onConflictDoNothing({ target: smsCodeLimits.key })
			const [row] = await tx
				.select()
				.from(smsCodeLimits)
				.where(eq(smsCodeLimits.key, key))
				.for("update")
			if (!row) throw new Error("SMS rate limiter unavailable")
			const expired = now.getTime() - row.windowStartedAt.getTime() >= SMS_CODE_WINDOW_MS
			if (!expired && row.count >= SMS_CODE_LIMIT) throw new SmsRateLimitError()
			await tx
				.update(smsCodeLimits)
				.set({
					windowStartedAt: expired ? now : row.windowStartedAt,
					count: expired ? 1 : row.count + 1,
				})
				.where(eq(smsCodeLimits.key, key))
		}
	})
}

/** No production sender is assumed. Only the adapter imports provider details. */
export function createSmsSender(environment: NodeJS.ProcessEnv = process.env): SmsSender {
	if (environment.SMS_PROVIDER !== "http") throw new Error("SMS provider is not configured")
	const endpoint = new URL(environment.SMS_API_URL ?? "")
	const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
	if (
		endpoint.protocol !== "https:" &&
		!(environment.NODE_ENV !== "production" && loopback && endpoint.protocol === "http:")
	)
		throw new Error("SMS provider requires HTTPS")
	const token = environment.SMS_API_TOKEN?.trim()
	const sender = environment.SMS_SENDER_NAME?.trim()
	if (!token || !sender || !/^[A-Za-z0-9 ]{1,11}$/.test(sender))
		throw new Error("SMS provider credentials or sender name are missing")
	return new HttpSmsSender(endpoint, token, sender)
}
