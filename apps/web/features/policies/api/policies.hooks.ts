"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { Policy, UpdatePolicyRequest } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

type ErrorBody = {
	message?: string
	error?: { message?: string }
	/** oRPC input validation puts the field messages here. */
	data?: { issues?: { message?: string }[] }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			...init?.headers,
		},
	})

	if (!response.ok) {
		let message = `Request failed (${response.status})`
		try {
			const body = (await response.json()) as ErrorBody
			// A validation failure names the field problem; prefer it over the generic text.
			message = body?.data?.issues?.[0]?.message ?? body?.message ?? body?.error?.message ?? message
		} catch {
			// Error bodies may be empty or non-JSON.
		}
		const retryAfterHeader =
			response.headers.get("retry-after") ?? response.headers.get("x-retry-after")
		const parsedRetryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN
		throw new ApiError(
			response.status,
			message,
			Number.isNaN(parsedRetryAfter) ? undefined : parsedRetryAfter
		)
	}

	if (response.status === 204) {
		return undefined as T
	}
	return (await response.json()) as T
}

export const policyKeys = {
	all: ["policies"] as const,
}

/** ADM-6: every registered Policy with its current value. Needs settings.policies:manage. */
export function usePoliciesQuery() {
	return useQuery({
		queryKey: policyKeys.all,
		queryFn: () => apiFetch<Policy[]>("/policies"),
	})
}

export function useUpdatePolicyMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: UpdatePolicyRequest) =>
			apiFetch<Policy>("/policies", { method: "PUT", body: JSON.stringify(input) }),
		onSuccess: saved => {
			queryClient.setQueryData<Policy[]>(policyKeys.all, current =>
				current?.map(policy => (policy.key === saved.key ? saved : policy))
			)
			void queryClient.invalidateQueries({ queryKey: policyKeys.all })
		},
	})
}
