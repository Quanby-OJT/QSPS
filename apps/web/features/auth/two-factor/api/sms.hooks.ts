"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	RequestSmsCodeInput,
	SmsSettings,
	UpdateSmsPreferencesInput,
	VerifySmsCodeInput,
} from "@repo/contracts"

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
		headers: { "Content-Type": "application/json", ...init?.headers },
	})

	if (!response.ok) {
		let message = `Request failed (${response.status})`
		try {
			const body = (await response.json()) as ErrorBody
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

	return (await response.json()) as T
}

export const smsKeys = {
	settings: ["me", "sms"] as const,
}

/** NTF-2: the caller's mobile number and SMS settings. Needs account.profile:manage. */
export function useSmsSettingsQuery() {
	return useQuery({
		queryKey: smsKeys.settings,
		queryFn: () => apiFetch<SmsSettings>("/me/sms"),
	})
}

export function useRequestSmsCodeMutation() {
	return useMutation({
		mutationFn: (input: RequestSmsCodeInput) =>
			apiFetch<{ ok: true }>("/me/sms/request-code", {
				method: "POST",
				body: JSON.stringify(input),
			}),
	})
}

export function useVerifySmsCodeMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: VerifySmsCodeInput) =>
			apiFetch<SmsSettings>("/me/sms/verify-code", {
				method: "POST",
				body: JSON.stringify(input),
			}),
		onSuccess: saved => queryClient.setQueryData(smsKeys.settings, saved),
	})
}

export function useUpdateSmsPreferencesMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: UpdateSmsPreferencesInput) =>
			apiFetch<SmsSettings>("/me/sms/preferences", {
				method: "PUT",
				body: JSON.stringify(input),
			}),
		onSuccess: saved => queryClient.setQueryData(smsKeys.settings, saved),
	})
}
