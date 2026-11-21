"use client"

import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"

import { createRetryAfterCapture, RateLimitError } from "@/core/lib/rate-limit-utils"
import { authClient } from "@/services/better-auth/auth-client"
import { captchaHeaders } from "@/features/auth/captcha/captcha"

export function useResetPasswordMutation() {
	const router = useRouter()

	return useMutation({
		mutationFn: async ({
			newPassword,
			token,
			captchaToken = null,
		}: {
			newPassword: string
			token: string
			captchaToken?: string | null
		}) => {
			const retryAfterCapture = createRetryAfterCapture()
			const result = await authClient.resetPassword({
				newPassword,
				token,
				fetchOptions: { ...retryAfterCapture.fetchOptions, headers: captchaHeaders(captchaToken) },
			})
			if (result.error) {
				if (result.error.status === 429) {
					throw new RateLimitError(retryAfterCapture.seconds(result.error))
				}
				throw new Error(result.error.message || "Failed to reset password")
			}
			return result
		},
		onSuccess: () => {
			router.push("/login")
		},
	})
}