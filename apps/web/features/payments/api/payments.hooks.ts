"use client"

import { useMutation, useQuery } from "@tanstack/react-query"

import type {
	CheckoutChannels,
	CreatePaymentInput,
	PaymentCheckout,
	PaymentStatusResponse,
	ReceiptVerification,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** Statuses that mean the provider's notification has not been processed yet. */
const WAITING_STATUSES = new Set(["initiated", "pending"])

/** How often the return page asks again, and for how long. */
const POLL_EVERY_MS = 3_000
export const POLL_FOR_MS = 2 * 60_000

async function readError(response: Response): Promise<ApiError> {
	let message = `Request failed (${response.status})`
	try {
		const body = (await response.json()) as { message?: string; error?: { message?: string } }
		message = body?.message ?? body?.error?.message ?? message
	} catch {
		// Error bodies may be empty or non-JSON.
	}
	return new ApiError(response.status, message)
}

/**
 * Start paying a booking. Returns the provider's checkout URL; the caller
 * sends the browser there. `idempotencyKey` makes a double click open one
 * checkout, not two.
 */
export function useCreatePaymentMutation() {
	return useMutation({
		mutationFn: async ({
			idempotencyKey,
			...input
		}: CreatePaymentInput & { idempotencyKey: string }): Promise<PaymentCheckout> => {
			const response = await fetch(`${API_BASE}/payments`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
				body: JSON.stringify(input),
			})
			if (!response.ok) throw await readError(response)
			return (await response.json()) as PaymentCheckout
		},
	})
}

export function isWaitingForProvider(status: PaymentStatusResponse["status"] | undefined): boolean {
	return status === undefined || WAITING_STATUSES.has(status)
}

/** A 4xx answer (not found, not signed in) will not change by asking again. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
	return failureCount < 2
}

/**
 * A payment's status, asked again every few seconds while the provider's
 * notification is still on its way. Read-only: this never marks anything paid.
 */
export function usePaymentStatusQuery(paymentId: number | null, keepPolling: boolean) {
	return useQuery({
		queryKey: ["payments", paymentId],
		enabled: paymentId !== null,
		queryFn: async (): Promise<PaymentStatusResponse> => {
			const response = await fetch(`${API_BASE}/payments/${paymentId}`, {
				credentials: "include",
			})
			if (!response.ok) throw await readError(response)
			return (await response.json()) as PaymentStatusResponse
		},
		retry: retryUnlessClientError,
		// Poll only after a real answer that says "still waiting". An error
		// (not found, signed out) stops polling, so a stranger's tab cannot
		// keep hitting the API and filling the audit log.
		refetchInterval: query => {
			const data = query.state.data
			if (!keepPolling || query.state.status === "error" || data === undefined) return false
			return isWaitingForProvider(data.status) ? POLL_EVERY_MS : false
		},
	})
}

/**
 * Where a paid payment's e-Receipt PDF is served (PAY-2). Opened as a normal
 * link so the browser shows its PDF viewer, with download and print.
 */
export function receiptPdfUrl(paymentId: number): string {
	return `${API_BASE}/payments/${paymentId}/receipt`
}

/** JSON turns the issue date into text. */
type ReceiptVerificationJson = Omit<ReceiptVerification, "issuedAt"> & { issuedAt: string }

/**
 * The public check behind a receipt's QR code. Needs no sign-in; a 404 means
 * no receipt has that token. Keyed under "payments" so it is never saved to
 * browser storage (NON_PERSISTED_QUERY_ROOTS).
 */
export function useReceiptVerificationQuery(token: string) {
	return useQuery({
		queryKey: ["payments", "receipts", "verify", token],
		retry: retryUnlessClientError,
		queryFn: async (): Promise<ReceiptVerification | null> => {
			const response = await fetch(`${API_BASE}/receipts/verify/${encodeURIComponent(token)}`)
			if (response.status === 404) return null
			if (!response.ok) throw await readError(response)
			const body = (await response.json()) as ReceiptVerificationJson
			return { ...body, issuedAt: new Date(body.issuedAt) }
		},
	})
}

/**
 * The channels a booking can be paid with, each with its convenience fee and
 * total, worked out by the server with the same function that charges the
 * payment (PAY-5). Under the "payments" root, so never saved to browser storage.
 */
export function useCheckoutChannelsQuery(bookingId: number) {
	return useQuery({
		queryKey: ["payments", "checkout", bookingId, "channels"],
		retry: retryUnlessClientError,
		queryFn: async (): Promise<CheckoutChannels> => {
			const response = await fetch(`${API_BASE}/payments/checkout/${bookingId}/channels`, {
				credentials: "include",
			})
			if (!response.ok) throw await readError(response)
			return (await response.json()) as CheckoutChannels
		},
	})
}
