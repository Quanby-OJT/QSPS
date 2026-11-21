"use client"

import { useQuery } from "@tanstack/react-query"

import type { DocumentSummary, MyDocuments } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** JSON turns the issue date into text. */
type MyDocumentsJson = {
	documents: (Omit<DocumentSummary, "issuedAt"> & { issuedAt: string })[]
}

/** A 4xx answer (not signed in, no permission) will not change by asking again. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
	return failureCount < 2
}

/**
 * The signed-in client's documents (CRT-1, My Documents). Keyed under
 * "certificates", which is never saved to browser storage
 * (NON_PERSISTED_QUERY_ROOTS): documents belong to one signed-in user.
 */
export function useMyDocumentsQuery() {
	return useQuery({
		queryKey: ["certificates", "mine"],
		retry: retryUnlessClientError,
		queryFn: async (): Promise<MyDocuments> => {
			const response = await fetch(`${API_BASE}/certificates/mine`, { credentials: "include" })
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
			const body = (await response.json()) as MyDocumentsJson
			return {
				documents: body.documents.map(document => ({
					...document,
					issuedAt: new Date(document.issuedAt),
				})),
			}
		},
	})
}

/**
 * Where a document's PDF is served (CRT-1). Opened as a normal link so the
 * browser shows its PDF viewer, with download and print.
 */
export function documentPdfUrl(documentId: number): string {
	return `${API_BASE}/certificates/documents/${documentId}/pdf`
}
