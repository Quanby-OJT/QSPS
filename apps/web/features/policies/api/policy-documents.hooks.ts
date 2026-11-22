"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	CreatePolicyDocumentInput,
	PolicyDocument,
	PolicyDocumentSummary,
	UpdatePolicyDocumentInput,
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
		throw new ApiError(response.status, message)
	}
	return (await response.json()) as T
}

/** A write sent once: a double click or a retry replays the first answer. */
function writeInit(method: string, body: unknown): RequestInit {
	return {
		method,
		body: JSON.stringify(body),
		headers: { "Idempotency-Key": crypto.randomUUID() },
	}
}

export const policyDocumentKeys = {
	all: ["policy-documents"] as const,
	published: ["policy-documents", "published"] as const,
	forService: (serviceId: number) => ["policy-documents", "service", serviceId] as const,
}

/** ADM-9: the newest version of every written policy. Needs settings.policies:manage. */
export function usePolicyDocumentsQuery() {
	return useQuery({
		queryKey: policyDocumentKeys.all,
		queryFn: () => apiFetch<PolicyDocument[]>("/policy-documents"),
	})
}

function useWrite<TInput>(send: (input: TInput) => Promise<PolicyDocument>) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: send,
		onSuccess: () => {
			// The admin list, the public page and every booking review read these.
			void queryClient.invalidateQueries({ queryKey: policyDocumentKeys.all })
		},
	})
}

export function useCreatePolicyDocumentMutation() {
	return useWrite((input: CreatePolicyDocumentInput) =>
		apiFetch<PolicyDocument>("/policy-documents", writeInit("POST", input))
	)
}

export function useUpdatePolicyDocumentMutation() {
	return useWrite(({ documentKey, ...input }: UpdatePolicyDocumentInput) =>
		apiFetch<PolicyDocument>(
			`/policy-documents/${encodeURIComponent(documentKey)}`,
			writeInit("PUT", input)
		)
	)
}

export function useWithdrawPolicyDocumentMutation() {
	return useWrite((documentKey: string) =>
		apiFetch<PolicyDocument>(
			`/policy-documents/${encodeURIComponent(documentKey)}/withdraw`,
			writeInit("POST", {})
		)
	)
}

/** The policies in effect today, for the public page. No session. */
export function usePublishedPoliciesQuery() {
	return useQuery({
		queryKey: policyDocumentKeys.published,
		queryFn: () => apiFetch<PolicyDocumentSummary[]>("/policy-documents/published"),
		staleTime: 0,
		refetchOnMount: "always",
	})
}

/**
 * The policies a client must read before booking one Service. Always fresh, so
 * the review step shows the version the API will check.
 */
export function useBookingPoliciesQuery(serviceId: number | null) {
	return useQuery({
		queryKey: policyDocumentKeys.forService(serviceId ?? 0),
		queryFn: () =>
			apiFetch<PolicyDocumentSummary[]>(`/bookings/policies?serviceId=${String(serviceId)}`),
		enabled: serviceId !== null,
		staleTime: 0,
		refetchOnMount: "always",
	})
}
