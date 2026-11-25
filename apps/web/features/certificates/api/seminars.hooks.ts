"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	SeminarAttendanceResult,
	SeminarIssueResult,
	SeminarRoster,
	SeminarSession,
	SeminarSessions,
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
			// Error bodies may be empty or non-JSON.
		}
		throw new ApiError(response.status, message)
	}

	return (await response.json()) as T
}

/** JSON turns the session times into text; these types are the responses as they arrive. */
type SessionJson = Omit<SeminarSession, "startsAt" | "endsAt"> & {
	startsAt: string
	endsAt: string
}
type SessionsJson = Omit<SeminarSessions, "sessions"> & { sessions: SessionJson[] }
type RosterJson = Omit<SeminarRoster, "session"> & { session: SessionJson }

function toSession(session: SessionJson): SeminarSession {
	return { ...session, startsAt: new Date(session.startsAt), endsAt: new Date(session.endsAt) }
}

/**
 * Keyed under "certificates", which is never saved to browser storage
 * (NON_PERSISTED_QUERY_ROOTS): a roster belongs to one signed-in staff user.
 */
export const seminarKeys = {
	all: ["certificates", "seminars"] as const,
	sessions: (date: string) => ["certificates", "seminars", "sessions", date] as const,
	roster: (scheduleSlotId: number) =>
		["certificates", "seminars", "roster", scheduleSlotId] as const,
}

/** A 4xx answer (no permission, session out of Scope) will not change by asking again. */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
	if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
	return failureCount < 2
}

/** The seminar sessions of one Manila date (YYYY-MM-DD) inside the caller's Scope. */
export function useSeminarSessionsQuery(date: string) {
	return useQuery({
		queryKey: seminarKeys.sessions(date),
		retry: retryUnlessClientError,
		queryFn: async (): Promise<SeminarSessions> => {
			const body = await apiFetch<SessionsJson>(
				`/certificates/seminar-sessions?date=${encodeURIComponent(date)}`
			)
			return { ...body, sessions: body.sessions.map(toSession) }
		},
	})
}

/** The clients booked into one session. Does nothing until a session is chosen. */
export function useSeminarRosterQuery(scheduleSlotId: number | null) {
	return useQuery({
		queryKey: seminarKeys.roster(scheduleSlotId ?? 0),
		enabled: scheduleSlotId !== null,
		retry: retryUnlessClientError,
		queryFn: async (): Promise<SeminarRoster> => {
			const body = await apiFetch<RosterJson>(
				`/certificates/seminar-sessions/${scheduleSlotId}/roster`
			)
			return { ...body, session: toSession(body.session) }
		},
	})
}

export interface MarkAttendanceRequest {
	present: number[]
	absent: number[]
}

/** Mark attendees present (checked in and cleared) or absent (`no_show`). */
export function useSeminarAttendanceMutation(scheduleSlotId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (body: MarkAttendanceRequest) =>
			apiFetch<SeminarAttendanceResult>(
				`/certificates/seminar-sessions/${scheduleSlotId}/attendance`,
				{ method: "POST", body: JSON.stringify(body) }
			),
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: seminarKeys.all })
			void queryClient.invalidateQueries({ queryKey: ["processing"] })
		},
	})
}

export interface IssueSeminarRequest {
	/** Without ids, every attendee marked present gets a certificate. */
	bookingItemIds?: number[]
	/** One per click, so a double click issues once. */
	idempotencyKey: string
}

/** Issue the Food Safety Training Certificate to the attendees marked present. */
export function useSeminarIssueMutation(scheduleSlotId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ idempotencyKey, ...body }: IssueSeminarRequest) =>
			apiFetch<SeminarIssueResult>(`/certificates/seminar-sessions/${scheduleSlotId}/issue`, {
				method: "POST",
				headers: { "Idempotency-Key": idempotencyKey },
				body: JSON.stringify(body),
			}),
		onSettled: () => {
			// Certificates change My Documents and the processing screens too.
			void queryClient.invalidateQueries({ queryKey: ["certificates"] })
			void queryClient.invalidateQueries({ queryKey: ["processing"] })
		},
	})
}
