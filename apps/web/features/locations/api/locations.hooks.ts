"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { CreateLocationInput, Location, UpdateLocationRequest } from "@repo/contracts"

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

	if (response.status === 204) {
		return undefined as T
	}
	return (await response.json()) as T
}

export const locationKeys = {
	all: ["locations", "all"] as const,
	available: ["locations", "available"] as const,
}

export function useLocationsQuery() {
	return useQuery({
		queryKey: locationKeys.all,
		queryFn: () => apiFetch<Location[]>("/locations"),
	})
}

export function useAvailableLocationsQuery() {
	return useQuery({
		queryKey: locationKeys.available,
		queryFn: () => apiFetch<Location[]>("/locations/available"),
	})
}

function useRefreshLocationQueries() {
	const queryClient = useQueryClient()
	return () => {
		void queryClient.invalidateQueries({ queryKey: locationKeys.all })
		void queryClient.invalidateQueries({ queryKey: locationKeys.available })
	}
}

export function useCreateLocationMutation() {
	const refresh = useRefreshLocationQueries()
	return useMutation({
		mutationFn: (input: CreateLocationInput) =>
			apiFetch<Location>("/locations", { method: "POST", body: JSON.stringify(input) }),
		onSuccess: refresh,
	})
}

export function useUpdateLocationMutation() {
	const refresh = useRefreshLocationQueries()
	return useMutation({
		mutationFn: ({ code, ...input }: UpdateLocationRequest) =>
			apiFetch<Location>(`/locations/${encodeURIComponent(code)}`, {
				method: "PUT",
				body: JSON.stringify(input),
			}),
		onSuccess: refresh,
	})
}

export function useSetLocationActiveMutation() {
	const refresh = useRefreshLocationQueries()
	return useMutation({
		mutationFn: ({ code, isActive }: { code: string; isActive: boolean }) =>
			apiFetch<Location>(`/locations/${encodeURIComponent(code)}/active`, {
				method: "PUT",
				body: JSON.stringify({ isActive }),
			}),
		onSuccess: refresh,
	})
}

export function useDeleteLocationMutation() {
	const refresh = useRefreshLocationQueries()
	return useMutation({
		mutationFn: (code: string) =>
			apiFetch<{ success: boolean; code: string }>(`/locations/${encodeURIComponent(code)}`, {
				method: "DELETE",
			}),
		onSuccess: refresh,
	})
}
