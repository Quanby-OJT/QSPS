"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	PaymentChannel,
	PaymentChannelSettings,
	UpdatePaymentChannelInput,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** Under the "payments" root, so payment settings are never saved to browser storage. */
export const paymentChannelKeys = {
	settings: ["payments", "channels", "settings"] as const,
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
			const body = (await response.json()) as { message?: string; error?: { message?: string } }
			message = body?.message ?? body?.error?.message ?? message
		} catch {
			// Error bodies may be empty or non-JSON.
		}
		throw new ApiError(response.status, message)
	}
	return (await response.json()) as T
}

/** A 4xx answer (no permission, not signed in) will not change by asking again. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
	return failureCount < 2
}

export function usePaymentChannelSettingsQuery() {
	return useQuery({
		queryKey: paymentChannelKeys.settings,
		retry: retryUnlessClientError,
		queryFn: () => apiFetch<PaymentChannelSettings>("/settings/payment-channels"),
	})
}

/** Save one channel. `idempotencyKey` makes a double click save once. */
export function useUpdatePaymentChannelMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({
			code,
			idempotencyKey,
			...input
		}: UpdatePaymentChannelInput & { idempotencyKey: string }) =>
			apiFetch<PaymentChannel>(`/settings/payment-channels/${encodeURIComponent(code)}`, {
				method: "PUT",
				headers: { "Idempotency-Key": idempotencyKey },
				body: JSON.stringify(input),
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: paymentChannelKeys.settings })
			// Checkout lists read the same settings.
			void queryClient.invalidateQueries({ queryKey: ["payments", "checkout"] })
		},
	})
}
