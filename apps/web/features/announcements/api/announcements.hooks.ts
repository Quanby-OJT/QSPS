"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	ActiveAnnouncement,
	Announcement,
	AnnouncementMediaUpload,
	CreateAnnouncementInput,
	SetAnnouncementActiveInput,
	UpdateAnnouncementInput,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** Full URL of a media path the API returned (relative to /api/v1). */
export function announcementMediaUrl(path: string): string {
	return `${API_BASE}${path}`
}

type ErrorBody = {
	message?: string
	error?: { message?: string }
	data?: { issues?: { message?: string }[] }
}

async function toApiError(response: Response): Promise<ApiError> {
	let message = `Request failed (${response.status})`
	try {
		const body = (await response.json()) as ErrorBody
		message = body?.data?.issues?.[0]?.message ?? body?.message ?? body?.error?.message ?? message
	} catch {
		// Error bodies may be empty or non-JSON.
	}
	return new ApiError(response.status, message)
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		credentials: "include",
		headers: { "Content-Type": "application/json", ...init?.headers },
	})
	if (!response.ok) throw await toApiError(response)
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

export const announcementKeys = {
	all: ["announcements"] as const,
	active: ["announcements", "active"] as const,
}

/** AUTH-4: every Announcement. Needs settings.announcements:manage. */
export function useAnnouncementsQuery() {
	return useQuery({
		queryKey: announcementKeys.all,
		queryFn: () => apiFetch<Announcement[]>("/announcements"),
		// A 403 will not change on retry; one denied audit entry is enough.
		retry: (failureCount, error) =>
			!(error instanceof ApiError && error.status === 403) && failureCount < 3,
	})
}

/** The flash screen before sign-in. Public; always fresh; a failure just shows the form. */
export function useActiveAnnouncementQuery() {
	return useQuery({
		queryKey: announcementKeys.active,
		queryFn: () => apiFetch<ActiveAnnouncement | null>("/announcements/active"),
		staleTime: 0,
		refetchOnMount: "always",
		retry: false,
	})
}

export function useUploadAnnouncementMediaMutation() {
	return useMutation({
		mutationFn: async (file: File) => {
			const body = new FormData()
			body.append("file", file)
			const response = await fetch(`${API_BASE}/announcements/media`, {
				method: "POST",
				body,
				credentials: "include",
			})
			if (!response.ok) throw await toApiError(response)
			return (await response.json()) as AnnouncementMediaUpload
		},
	})
}

function useWrite<TInput>(send: (input: TInput) => Promise<Announcement>) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: send,
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: announcementKeys.all })
		},
	})
}

export function useCreateAnnouncementMutation() {
	return useWrite((input: CreateAnnouncementInput) =>
		apiFetch<Announcement>("/announcements", writeInit("POST", input))
	)
}

export function useUpdateAnnouncementMutation() {
	return useWrite(({ id, ...input }: UpdateAnnouncementInput) =>
		apiFetch<Announcement>(`/announcements/${id}`, writeInit("PUT", input))
	)
}

export function useSetAnnouncementActiveMutation() {
	return useWrite(({ id, isActive }: SetAnnouncementActiveInput) =>
		apiFetch<Announcement>(`/announcements/${id}/active`, writeInit("PATCH", { isActive }))
	)
}
