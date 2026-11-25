"use client"

import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { PRIVACY_NOTICE_VERSION, type ClientProfile } from "@repo/contracts"

import { sessionKeys } from "@/features/auth/api/session.hooks"
import { readError } from "@/features/bookings/api/bookings.hooks"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** Accept the Privacy Notice now shown (PRC-2b), then enter the portal. */
export function useAcceptPrivacyNoticeMutation() {
	const router = useRouter()
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: async (): Promise<ClientProfile> => {
			const response = await fetch(`${API_BASE}/me/privacy-notice`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ privacyNoticeVersion: PRIVACY_NOTICE_VERSION }),
			})
			if (!response.ok) throw await readError(response)
			return (await response.json()) as ClientProfile
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: sessionKeys.all })
			router.push("/dashboard")
			router.refresh()
		},
	})
}
