"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	CreateRoleInput,
	CreateStaffUserInput,
	DeleteUserResponse,
	ExportUsersRequest,
	ExportUsersResponse,
	ListAuditLogResponse,
	ListUsersRequest,
	ListUsersResponse,
	PermissionCatalogEntry,
	PermissionName,
	Role,
	ScopeEntryInput,
	SetUserStatusRequest,
	UpdateRoleRequest,
	UpdateUserRequest,
	UserScopes,
	UserWithRoles,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

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
			const body = (await response.json()) as { message?: string; error?: { message?: string } }
			message = body?.message ?? body?.error?.message ?? message
		} catch {
			// ignore non-JSON error bodies
		}
		const retryAfterHeader =
			response.headers.get("retry-after") ?? response.headers.get("x-retry-after")
		const parsedRetryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN
		const retryAfter = Number.isNaN(parsedRetryAfter) ? undefined : parsedRetryAfter
		throw new ApiError(response.status, message, retryAfter)
	}

	if (response.status === 204) {
		return undefined as T
	}

	return (await response.json()) as T
}

function buildUserQueryString(params: Record<string, string | number | undefined>): string {
	const searchParams = new URLSearchParams()
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") {
			searchParams.set(key, String(value))
		}
	}
	const qs = searchParams.toString()
	return qs ? `?${qs}` : ""
}

export const rbacKeys = {
	roles: ["rbac", "roles"] as const,
	permissions: ["rbac", "permissions"] as const,
	users: ["rbac", "users"] as const,
	usersFiltered: (filters: Partial<ListUsersRequest>) => ["rbac", "users", filters] as const,
	auditLog: ["rbac", "audit-log"] as const,
}

// ---------------------------------------------------------------- queries
/** A refused request (403) will not succeed on a retry. */
function retryUnlessForbidden(failureCount: number, error: unknown): boolean {
	if (error instanceof ApiError && error.status === 403) return false
	return failureCount < 3
}

/**
 * Needs users.roles:manage. Pass `enabled: false` when the caller lacks it,
 * so no request (and no denied audit entry) is made at all.
 */
export function useRolesQuery(enabled = true) {
	return useQuery({
		queryKey: rbacKeys.roles,
		queryFn: () => apiFetch<Role[]>("/rbac/roles"),
		enabled,
		retry: retryUnlessForbidden,
	})
}

export function usePermissionsQuery() {
	return useQuery({
		queryKey: rbacKeys.permissions,
		queryFn: () => apiFetch<PermissionCatalogEntry[]>("/rbac/permissions"),
		staleTime: 5 * 60 * 1000,
	})
}

export function useUsersQuery(filters: Partial<ListUsersRequest> = {}) {
	return useQuery({
		queryKey: rbacKeys.usersFiltered(filters),
		queryFn: () => apiFetch<ListUsersResponse>(`/rbac/users${buildUserQueryString(filters)}`),
	})
}

/**
 * ADM-2: a staff user's Scope. Needs users.scopes:manage, so callers without
 * it get a 403; the query does not retry that.
 */
export function useUserScopesQuery(userId: string | undefined) {
	return useQuery({
		queryKey: [...rbacKeys.users, userId, "scopes"] as const,
		queryFn: () => apiFetch<UserScopes>(`/rbac/users/${encodeURIComponent(userId ?? "")}/scopes`),
		enabled: Boolean(userId),
		retry: false,
	})
}

export function useAuditLogQuery(limit = 50) {
	return useQuery({
		queryKey: [...rbacKeys.auditLog, limit],
		queryFn: () => apiFetch<ListAuditLogResponse>(`/rbac/audit-log?limit=${limit}`),
	})
}

// -------------------------------------------------------------- mutations
export function useCreateRoleMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (payload: CreateRoleInput) =>
			apiFetch<Role>("/rbac/roles", { method: "POST", body: JSON.stringify(payload) }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: rbacKeys.roles }),
	})
}

export function useUpdateRoleMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, ...rest }: UpdateRoleRequest) =>
			apiFetch<Role>(`/rbac/roles/${id}`, { method: "PUT", body: JSON.stringify(rest) }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: rbacKeys.roles }),
	})
}

export function useSetRolePermissionsMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, permissions }: { id: number; permissions: PermissionName[] }) =>
			apiFetch<Role>(`/rbac/roles/${id}/permissions`, {
				method: "PUT",
				body: JSON.stringify({ permissions }),
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: rbacKeys.roles }),
	})
}

export function useDeleteRoleMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: number) =>
			apiFetch<{ success: boolean; id: number }>(`/rbac/roles/${id}`, { method: "DELETE" }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: rbacKeys.roles }),
	})
}

export function useCreateStaffUserMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (payload: CreateStaffUserInput) =>
			apiFetch<UserWithRoles>("/rbac/users", {
				method: "POST",
				body: JSON.stringify(payload),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: rbacKeys.users })
			queryClient.invalidateQueries({ queryKey: rbacKeys.roles })
		},
	})
}

export function useUpdateUserMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ userId, ...rest }: UpdateUserRequest) =>
			apiFetch<UserWithRoles>(`/rbac/users/${encodeURIComponent(userId)}`, {
				method: "PUT",
				body: JSON.stringify(rest),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: rbacKeys.users })
		},
	})
}

/** ADM-2: replace a staff user's Scope. */
export function useSetUserScopesMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ userId, scopes }: { userId: string; scopes: ScopeEntryInput[] }) =>
			apiFetch<UserScopes>(`/rbac/users/${encodeURIComponent(userId)}/scopes`, {
				method: "PUT",
				body: JSON.stringify({ scopes }),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: rbacKeys.users })
		},
	})
}

export function useSetUserStatusMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ userId, isActive }: SetUserStatusRequest) =>
			apiFetch<UserWithRoles>(`/rbac/users/${encodeURIComponent(userId)}/status`, {
				method: "PUT",
				body: JSON.stringify({ isActive }),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: rbacKeys.users })
		},
	})
}

export function useDeleteUserMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (userId: string) =>
			apiFetch<DeleteUserResponse>(`/rbac/users/${encodeURIComponent(userId)}`, {
				method: "DELETE",
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: rbacKeys.users })
			queryClient.invalidateQueries({ queryKey: rbacKeys.roles })
		},
	})
}

export function useExportUsersMutation() {
	return useMutation({
		mutationFn: async (params: ExportUsersRequest) => {
			const res = await apiFetch<ExportUsersResponse>(
				`/rbac/users/export${buildUserQueryString(params)}`
			)
			const binary = atob(res.contentBase64)
			const bytes = new Uint8Array(binary.length)
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i)
			}
			const blob = new Blob([bytes], { type: res.mimeType })
			const url = URL.createObjectURL(blob)
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

export function useAssignRoleMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ userId, roleName }: { userId: string; roleName: string }) =>
			apiFetch(`/rbac/users/${encodeURIComponent(userId)}/roles`, {
				method: "POST",
				body: JSON.stringify({ roleName }),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: rbacKeys.users })
			queryClient.invalidateQueries({ queryKey: rbacKeys.roles })
		},
	})
}

export function useRemoveRoleMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ userId, roleName }: { userId: string; roleName: string }) =>
			apiFetch(`/rbac/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleName)}`, {
				method: "DELETE",
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: rbacKeys.users })
			queryClient.invalidateQueries({ queryKey: rbacKeys.roles })
		},
	})
}
