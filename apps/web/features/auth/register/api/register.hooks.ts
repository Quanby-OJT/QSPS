"use client"

import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { PRIVACY_NOTICE_VERSION } from "@repo/contracts"

import { createRetryAfterCapture, RateLimitError } from "@/core/lib/rate-limit-utils"
import { authClient } from "@/services/better-auth/auth-client"
import { sessionKeys } from "@/features/auth/api/session.hooks"
import { captchaHeaders } from "@/features/auth/captcha/captcha"

import type { Register } from "./register.schema"

type SignUpInput = Parameters<typeof authClient.signUp.email>[0]

export function useRegisterMutation() {
	const router = useRouter()
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async ({
			privacyAccepted,
			captchaToken = null,
			...data
		}: Register & { captchaToken?: string | null }) => {
			const retryAfterCapture = createRetryAfterCapture()
			// The server refuses a sign-up without the current notice version, so
			// the version is sent only when the visitor ticked the box.
			const result = await authClient.signUp.email({
				...data,
				...(privacyAccepted ? { privacyNoticeVersion: PRIVACY_NOTICE_VERSION } : {}),
				fetchOptions: { ...retryAfterCapture.fetchOptions, headers: captchaHeaders(captchaToken) },
			} as SignUpInput)
			if (result.error) {
				if (result.error.status === 429) {
					throw new RateLimitError(retryAfterCapture.seconds(result.error))
				}
				throw new Error(result.error.message || "Failed to sign up")
			}
			// When email verification enforcement is on, Better Auth returns a user
			// but no session token — the user must verify before signing in.
			const requiresVerification = !result.data?.token
			return { requiresVerification, email: data.email }
		},
		onSuccess: ({ requiresVerification }) => {
			queryClient.invalidateQueries({ queryKey: sessionKeys.all })
			if (!requiresVerification) {
				router.push("/")
				router.refresh()
			}
		},
	})
}