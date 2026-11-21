"use client"

import { useMutation } from "@tanstack/react-query"

import { createRetryAfterCapture, RateLimitError } from "@/core/lib/rate-limit-utils"
import { authClient } from "@/services/better-auth/auth-client"

import type { ChangePassword } from "./change-password.schema"

/**
 * AUTH-3: set a new password while signed in (the forced change after staff
 * password rotation). Other sessions are signed out. The server refuses a
 * staff password that matches one of the last five.
 */
export function useChangePasswordMutation() {
	return useMutation({
		mutationFn: async ({ currentPassword, newPassword }: ChangePassword) => {
			const retryAfterCapture = createRetryAfterCapture()
			const result = await authClient.changePassword({
				currentPassword,
				newPassword,
				revokeOtherSessions: true,
				fetchOptions: retryAfterCapture.fetchOptions,
			})
			if (result.error) {
				if (result.error.status === 429) {
					throw new RateLimitError(retryAfterCapture.seconds(result.error))
				}
				throw new Error(result.error.message || "Could not change the password")
			}
			return result
		},
	})
}