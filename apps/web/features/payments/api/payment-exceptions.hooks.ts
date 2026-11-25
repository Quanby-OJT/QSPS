"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
	PaymentExceptionListSchema,
	type PaymentExceptionList,
	type ResolvePaymentReviewInput,
	type ResolvePaymentReviewResult,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** Under the "payments" root, so this list is never saved to browser storage. */
export const paymentExceptionKeys = {
	list: ["payments", "exceptions"] as const,
}

async function readError(response: Response): Promise<ApiError> {
	let message = `Request failed (${response.status})`
	try {
		const body = (await response.json()) as {
			message?: string
			error?: { message?: string }
			data?: { issues?: { message?: string }[] }
		}
		message = body?.data?.issues?.[0]?.message ?? body?.message ?? body?.error?.message ?? message
	} catch {
		// Error bodies may be empty or non-JSON.
	}
	return new ApiError(response.status, message)
}

/** A 4xx answer (no permission) will not change by asking again. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
	return failureCount < 2
}

/** PAY-6: open payment exceptions in the caller's Scope. */
export function usePaymentExceptionsQuery() {
	return useQuery({
		queryKey: paymentExceptionKeys.list,
		retry: retryUnlessClientError,
		queryFn: async (): Promise<PaymentExceptionList> => {
			const response = await fetch(`${API_BASE}/payment-exceptions`, { credentials: "include" })
			if (!response.ok) throw await readError(response)
			// Dates arrive as text; the schema turns them back into Dates.
			return PaymentExceptionListSchema.parse(await response.json())
		},
	})
}

/** Resolve one exception: rebooked, or a Refund Request opened. */
export function useResolvePaymentExceptionMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({
			paymentId,
			...body
		}: ResolvePaymentReviewInput): Promise<ResolvePaymentReviewResult> => {
			const response = await fetch(`${API_BASE}/payment-exceptions/${paymentId}/resolve`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			if (!response.ok) throw await readError(response)
			return (await response.json()) as ResolvePaymentReviewResult
		},
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: paymentExceptionKeys.list }),
	})
}
