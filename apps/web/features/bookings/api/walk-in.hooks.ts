"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	Booking,
	BookingForm,
	CreateWalkInBookingInput,
	CreateWalkInClientInput,
	PolicyDocumentSummary,
	WalkInClient,
	WalkInSlots,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"
import { readError, toBooking, type BookingJson } from "@/features/bookings/api/bookings.hooks"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** Where staff upload a file answer for a walk-in client (PRC-2). */
export const WALK_IN_FORM_UPLOAD_PATH = "/walk-in/form-uploads"

/**
 * PRC-2 queries. The "walk-in" root is never written to browser storage
 * (NON_PERSISTED_QUERY_ROOTS): lookups carry other people's personal data.
 */
export const walkInKeys = {
	all: ["walk-in"] as const,
	clients: (query: string) => ["walk-in", "clients", query] as const,
	slots: (serviceId: number) => ["walk-in", "slots", serviceId] as const,
	policies: (serviceId: number) => ["walk-in", "policies", serviceId] as const,
	form: (serviceId: number) => ["walk-in", "form", serviceId] as const,
}

/** A new account was refused because a client already has this email or mobile. */
export class WalkInDuplicateClientError extends ApiError {
	constructor(
		status: number,
		message: string,
		readonly clientId: string,
		/** Which detail matched, so the screen can look the account up by it. */
		readonly matchedBy: "email" | "mobile"
	) {
		super(status, message)
	}
}

async function getJson<T>(path: string): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, { credentials: "include" })
	if (!response.ok) throw await readError(response)
	return (await response.json()) as T
}

/** Client accounts with exactly this email or mobile number. Null asks nothing. */
export function useWalkInClientLookupQuery(query: string | null) {
	return useQuery({
		queryKey: walkInKeys.clients(query ?? ""),
		enabled: query !== null,
		queryFn: () =>
			getJson<WalkInClient[]>(`/walk-in/clients?query=${encodeURIComponent(query ?? "")}`),
		staleTime: 0,
	})
}

/**
 * Create a client account for a walk-in; the API emails the invitation to set
 * a password. A duplicate arrives as `WalkInDuplicateClientError`.
 */
export function useCreateWalkInClientMutation() {
	return useMutation({
		mutationFn: async ({
			idempotencyKey,
			...input
		}: CreateWalkInClientInput & { idempotencyKey: string }): Promise<WalkInClient> => {
			const response = await fetch(`${API_BASE}/walk-in/clients`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
				body: JSON.stringify(input),
			})
			if (response.status === 409) {
				let message = "An account already has these details"
				let clientId: unknown
				let matchedBy: unknown
				try {
					const body = (await response.json()) as {
						message?: string
						data?: { clientId?: unknown; matchedBy?: unknown }
					}
					message = body.message ?? message
					clientId = body.data?.clientId
					matchedBy = body.data?.matchedBy
				} catch {
					// Error bodies may be empty or non-JSON.
				}
				if (typeof clientId === "string") {
					throw new WalkInDuplicateClientError(
						409,
						message,
						clientId,
						matchedBy === "mobile" ? "mobile" : "email"
					)
				}
				throw new ApiError(409, message)
			}
			if (!response.ok) throw await readError(response)
			return (await response.json()) as WalkInClient
		},
	})
}

type WalkInSlotsJson = Omit<WalkInSlots, "slots"> & {
	slots: (Omit<WalkInSlots["slots"][number], "startsAt" | "endsAt"> & {
		startsAt: string
		endsAt: string
	})[]
}

/** Today's slots for the Service at the officer's Location. Always fresh. */
export function useWalkInSlotsQuery(serviceId: number | null) {
	return useQuery({
		queryKey: walkInKeys.slots(serviceId ?? 0),
		enabled: serviceId !== null,
		queryFn: async (): Promise<WalkInSlots> => {
			const body = await getJson<WalkInSlotsJson>(`/walk-in/slots?serviceId=${String(serviceId)}`)
			return {
				...body,
				slots: body.slots.map(slot => ({
					...slot,
					startsAt: new Date(slot.startsAt),
					endsAt: new Date(slot.endsAt),
				})),
			}
		},
		staleTime: 0,
		refetchOnMount: "always",
	})
}

/** The policies the client reads and accepts at the counter (ADM-9). */
export function useWalkInPoliciesQuery(serviceId: number | null) {
	return useQuery({
		queryKey: walkInKeys.policies(serviceId ?? 0),
		enabled: serviceId !== null,
		queryFn: () =>
			getJson<PolicyDocumentSummary[]>(`/walk-in/policies?serviceId=${String(serviceId)}`),
		staleTime: 0,
		refetchOnMount: "always",
	})
}

/** The Service's active questionnaire, or null (FRM-2). */
export function useWalkInFormQuery(serviceId: number | null) {
	return useQuery({
		queryKey: walkInKeys.form(serviceId ?? 0),
		enabled: serviceId !== null,
		queryFn: () => getJson<BookingForm | null>(`/walk-in/form?serviceId=${String(serviceId)}`),
		staleTime: 0,
		refetchOnMount: "always",
	})
}

/**
 * Book the walk-in client. Refusals arrive as the booking errors
 * (`BookingCheckoutError` for a slot, `BookingFormError` for answers).
 */
export function useCreateWalkInBookingMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({
			idempotencyKey,
			...input
		}: CreateWalkInBookingInput & { idempotencyKey: string }): Promise<Booking> => {
			const response = await fetch(`${API_BASE}/walk-in/bookings`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
				body: JSON.stringify(input),
			})
			if (!response.ok) throw await readError(response)
			return toBooking((await response.json()) as BookingJson)
		},
		// A place was taken: availability shown anywhere is out of date.
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["schedules"] })
			void queryClient.invalidateQueries({ queryKey: walkInKeys.all })
		},
	})
}
