"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { replaceLocation } from "@/core/lib/navigate"
import { createRetryAfterCapture, RateLimitError } from "@/core/lib/rate-limit-utils"
import { authClient } from "@/services/better-auth/auth-client"
import { sessionKeys } from "@/features/auth/api/session.hooks"

/** The three ways to answer the second-factor challenge (AUTH-2). */
export type TwoFactorMethod = "totp" | "otp" | "backup_code"

/**
 * The short-lived challenge from the password step is gone (expired, or the
 * page was opened directly). The only way forward is to sign in again.
 */
export class ChallengeExpiredError extends Error {
	constructor() {
		super("Your sign-in step has expired. Please sign in again.")
		this.name = "ChallengeExpiredError"
	}
}

type RetryCapture = ReturnType<typeof createRetryAfterCapture>
type AuthCallError = Parameters<RetryCapture["seconds"]>[0] & {
	message?: string
	code?: string
	status?: number
}

function isExpiredChallenge(error: { message?: string; code?: string }) {
	const code = error.code?.toUpperCase() ?? ""
	const message = error.message?.toLowerCase() ?? ""
	return code.includes("TWO_FACTOR_COOKIE") || message.includes("two factor cookie")
}

/** Runs one Better Auth call and turns its error into the errors the forms show. */
async function unwrap<T>(
	run: (
		fetchOptions: RetryCapture["fetchOptions"]
	) => Promise<{ data: T | null; error: AuthCallError | null }>,
	fallback: string
): Promise<T> {
	const capture = createRetryAfterCapture()
	const result = await run(capture.fetchOptions)
	if (result.error) {
		if (result.error.status === 429) {
			throw new RateLimitError(capture.seconds(result.error))
		}
		if (isExpiredChallenge(result.error)) {
			throw new ChallengeExpiredError()
		}
		throw new Error(result.error.message || fallback)
	}
	return result.data as T
}

/** Challenge step: checks the code, then opens the dashboard with the new session. */
export function useVerifyTwoFactorMutation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ method, code }: { method: TwoFactorMethod; code: string }) => {
			const twoFactor = authClient.twoFactor
			const fallback = "That code did not work. Please try again."
			if (method === "totp") {
				return unwrap(fetchOptions => twoFactor.verifyTotp({ code, fetchOptions }), fallback)
			}
			if (method === "otp") {
				return unwrap(fetchOptions => twoFactor.verifyOtp({ code, fetchOptions }), fallback)
			}
			return unwrap(fetchOptions => twoFactor.verifyBackupCode({ code, fetchOptions }), fallback)
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: sessionKeys.all })
			replaceLocation("/dashboard")
		},
	})
}

/** Challenge step: emails a 6-digit code to the account address. */
export function useSendEmailCodeMutation() {
	return useMutation({
		mutationFn: () =>
			unwrap(
				fetchOptions => authClient.twoFactor.sendOtp({ fetchOptions }),
				"The code could not be sent. Please try again."
			),
	})
}

/** Enrolment step 1: checks the password and returns the QR link and recovery codes. */
export function useEnableTwoFactorMutation() {
	return useMutation({
		mutationFn: ({ password }: { password: string }) =>
			unwrap(
				fetchOptions => authClient.twoFactor.enable({ password, fetchOptions }),
				"Two-factor authentication could not be started."
			),
	})
}

/** Enrolment step 2: the first authenticator code turns two-factor on. */
export function useConfirmAuthenticatorMutation() {
	return useMutation({
		mutationFn: ({ code }: { code: string }) =>
			unwrap(
				fetchOptions => authClient.twoFactor.verifyTotp({ code, fetchOptions }),
				"That code did not work. Check the time on your phone and try again."
			),
	})
}

/** Settings: new recovery codes. The old ones stop working. */
export function useGenerateRecoveryCodesMutation() {
	return useMutation({
		mutationFn: ({ password }: { password: string }) =>
			unwrap(
				fetchOptions => authClient.twoFactor.generateBackupCodes({ password, fetchOptions }),
				"New recovery codes could not be made."
			),
	})
}

/** Settings: turns two-factor off. The server refuses this for staff accounts. */
export function useDisableTwoFactorMutation() {
	return useMutation({
		mutationFn: ({ password }: { password: string }) =>
			unwrap(
				fetchOptions => authClient.twoFactor.disable({ password, fetchOptions }),
				"Two-factor authentication could not be turned off."
			),
	})
}
