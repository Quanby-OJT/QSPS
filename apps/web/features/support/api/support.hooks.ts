"use client"

import { useQuery } from "@tanstack/react-query"

import type { SupportContacts } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

export const supportKeys = {
	contacts: ["support", "contacts"] as const,
}

/**
 * ADM-8: the help desk channels for the Help page. Public, no session. Always
 * refetched when the page opens, so a change on the policy screen shows on
 * the next visit.
 */
export function useSupportContactsQuery() {
	return useQuery({
		queryKey: supportKeys.contacts,
		queryFn: async () => {
			const response = await fetch(`${API_BASE}/support/contacts`)
			if (!response.ok) {
				throw new ApiError(
					response.status,
					`Could not load the help desk contacts (${response.status})`
				)
			}
			return (await response.json()) as SupportContacts
		},
		staleTime: 0,
		refetchOnMount: "always",
	})
}
