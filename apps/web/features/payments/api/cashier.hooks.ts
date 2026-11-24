"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
	CashierSearchResultSchema,
	type CashierSearchResult,
	type CollectOnsiteInput,
	type CollectOnsiteResult,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** Under the "payments" root, so cashier lookups are never saved to browser storage. */
export const cashierKeys = {
	search: (query: string) => ["payments", "cashier", "search", query] as const,
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

/** A 4xx answer (no permission, outside Scope, not found) will not change by asking again. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
	return failureCount < 2
}

/**
 * PAY-4: find bookings by Reference Number, client email or name. Runs only
 * for a submitted search, never on every keystroke.
 */
export function useCashierSearchQuery(query: string | null) {
	return useQuery({
		queryKey: cashierKeys.search(query ?? ""),
		enabled: query !== null && query.length > 0,
		retry: retryUnlessClientError,
		queryFn: async (): Promise<CashierSearchResult> => {
			const response = await fetch(
				`${API_BASE}/cashier/bookings?q=${encodeURIComponent(query ?? "")}`,
				{ credentials: "include" }
			)
			if (!response.ok) throw await readError(response)
			// Dates arrive as text; the schema turns them back into Dates.
			return CashierSearchResultSchema.parse(await response.json())
		},
	})
}

/**
 * Record the payment. `idempotencyKey` makes a double click record one
 * Payment, not two: the API replays the first answer.
 */
export function useCollectOnsiteMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		// A later search shows the booking as paid, not the stale answer.
		onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["payments", "cashier"] }),
		mutationFn: async ({
			idempotencyKey,
			bookingId,
			...body
		}: CollectOnsiteInput & { idempotencyKey: string }): Promise<CollectOnsiteResult> => {
			const response = await fetch(`${API_BASE}/cashier/bookings/${bookingId}/collect`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
				body: JSON.stringify(body),
			})
			if (!response.ok) throw await readError(response)
			return (await response.json()) as CollectOnsiteResult
		},
	})
}

/** The receipt PDF for printing: A4, or the passbook-printer page. Opened in a new tab. */
export function cashierReceiptUrl(paymentId: number, layout: "a4" | "passbook"): string {
	return `${API_BASE}/cashier/payments/${paymentId}/receipt?layout=${layout}`
}
