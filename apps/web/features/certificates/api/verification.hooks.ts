"use client"

import { useQuery } from "@tanstack/react-query"

import type { DocumentVerification, ManualVerificationInput } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** JSON turns the dates into text. */
type DocumentVerificationJson = Omit<DocumentVerification, "issuedAt" | "statusChangedAt"> & {
	issuedAt: string
	statusChangedAt: string | null
}

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

/** A 4xx answer (no record, too many requests) will not change by asking again at once. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
	return failureCount < 2
}

/**
 * One public lookup. A malformed token or number is refused by the API with
 * 400 and an unknown one with 404; the page shows both the same way, as "no
 * record found", so it reveals nothing about why.
 */
async function lookUp(url: string): Promise<DocumentVerification | null> {
	const response = await fetch(url)
	if (response.status === 400 || response.status === 404) return null
	if (!response.ok) throw await readError(response)
	const body = (await response.json()) as DocumentVerificationJson
	return {
		...body,
		issuedAt: new Date(body.issuedAt),
		statusChangedAt: body.statusChangedAt ? new Date(body.statusChangedAt) : null,
	}
}

/**
 * The public check behind a document's QR code (CRT-2). Needs no sign-in.
 * Keyed under "certificates" so it is never saved to browser storage
 * (NON_PERSISTED_QUERY_ROOTS).
 */
export function useDocumentVerificationQuery(token: string) {
	return useQuery({
		queryKey: ["certificates", "verify", token],
		retry: retryUnlessClientError,
		queryFn: () => lookUp(`${API_BASE}/certificates/verify/${encodeURIComponent(token)}`),
	})
}

/** The same check by Document Number and the code under the QR code; runs once submitted. */
export function useManualVerificationQuery(input: ManualVerificationInput | null) {
	return useQuery({
		queryKey: ["certificates", "verify", "manual", input?.documentNumber, input?.code],
		enabled: input !== null,
		retry: retryUnlessClientError,
		queryFn: () => {
			const params = new URLSearchParams({
				documentNumber: input?.documentNumber ?? "",
				code: input?.code ?? "",
			})
			return lookUp(`${API_BASE}/certificates/verify?${params.toString()}`)
		},
	})
}

/** True when the API refused because one address asked too often (StrictThrottle). */
export function isRateLimited(error: Error | null): boolean {
	return error instanceof ApiError && error.status === 429
}
