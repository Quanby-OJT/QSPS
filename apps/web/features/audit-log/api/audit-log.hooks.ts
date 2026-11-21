"use client"

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"

import type {
	AuditLogEntry,
	AuditLogEntryDetail,
	AuditLogFilter,
	ExportAuditLogRequest,
	ExportAuditLogResponse,
	ListAuditLogResponse,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"
import { AUDIT_PAGE_SIZE, auditQueryString } from "@/features/audit-log/lib/filters"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** JSON turns dates into text. */
type WithTextDate<T> = Omit<T, "createdAt"> & { createdAt: string }

async function apiGet<T>(path: string): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, { credentials: "include" })
	if (!response.ok) {
		let message = `Request failed (${response.status})`
		try {
			const body = (await response.json()) as { message?: string; error?: { message?: string } }
			message = body?.message ?? body?.error?.message ?? message
		} catch {
			// Error bodies may be empty or non-JSON.
		}
		const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10)
		throw new ApiError(response.status, message, Number.isNaN(retryAfter) ? undefined : retryAfter)
	}
	return (await response.json()) as T
}

function withDate<T extends { createdAt: Date }>(entry: WithTextDate<T>): T {
	return { ...entry, createdAt: new Date(entry.createdAt) } as T
}

/**
 * A 4xx answer (no audit.logs:read, bad filter) will not change by asking
 * again, and every refused request writes a denied audit entry.
 */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
	return failureCount < 2
}

export const auditLogKeys = {
	all: ["rbac", "audit-log"] as const,
	list: (filter: AuditLogFilter) => ["rbac", "audit-log", "list", filter] as const,
	entry: (id: number) => ["rbac", "audit-log", "entry", id] as const,
}

/** ADM-3: entries newest first, a page at a time (cursor paging). */
export function useAuditLogQuery(filter: AuditLogFilter) {
	return useInfiniteQuery({
		queryKey: auditLogKeys.list(filter),
		initialPageParam: undefined as number | undefined,
		queryFn: async ({ pageParam }) => {
			const body = await apiGet<{
				entries: WithTextDate<AuditLogEntry>[]
				nextCursor: number | null
			}>(
				`/rbac/audit-log${auditQueryString({ ...filter, limit: AUDIT_PAGE_SIZE, before: pageParam })}`
			)
			return {
				entries: body.entries.map(entry => withDate<AuditLogEntry>(entry)),
				nextCursor: body.nextCursor,
			} satisfies ListAuditLogResponse
		},
		getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
		retry: retryUnlessClientError,
		// A denial is audited; do not repeat it each time the tab regains focus.
		refetchOnWindowFocus: false,
	})
}

/** ADM-3: one entry, opened, with its hash. */
export function useAuditEntryQuery(id: number | null) {
	return useQuery({
		queryKey: auditLogKeys.entry(id ?? 0),
		enabled: id !== null,
		queryFn: async () =>
			withDate<AuditLogEntryDetail>(
				await apiGet<WithTextDate<AuditLogEntryDetail>>(`/rbac/audit-log/${id}`)
			),
		retry: retryUnlessClientError,
		staleTime: Infinity, // An audit entry never changes.
	})
}

/** ADM-3: download the filtered entries as CSV or PDF. The export is itself audited. */
export function useExportAuditLogMutation() {
	return useMutation({
		mutationFn: async (params: ExportAuditLogRequest): Promise<ExportAuditLogResponse> => {
			const res = await apiGet<ExportAuditLogResponse>(
				`/rbac/audit-log/export${auditQueryString({ ...params })}`
			)
			const binary = atob(res.contentBase64)
			const bytes = new Uint8Array(binary.length)
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
			const url = URL.createObjectURL(new Blob([bytes], { type: res.mimeType }))
			const link = document.createElement("a")
			link.href = url
			link.download = res.fileName
			document.body.appendChild(link)
			link.click()
			link.remove()
			URL.revokeObjectURL(url)
			return res
		},
	})
}