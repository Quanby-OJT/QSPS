"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	GenerateSlotsInput,
	GenerateSlotsResponse,
	ListSlotsRequest,
	ScheduleSlot,
	SetSlotDisabledRequest,
	UpdateSlotCapacityRequest,
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
		const retryAfterHeader =
			response.headers.get("retry-after") ?? response.headers.get("x-retry-after")
		const parsedRetryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN
		throw new ApiError(
			response.status,
			message,
			Number.isNaN(parsedRetryAfter) ? undefined : parsedRetryAfter
		)
	}

	return (await response.json()) as T
}

/** JSON turns dates into text; this turns the slot's dates back into `Date`s. */
type SlotJson = Omit<ScheduleSlot, "startsAt" | "endsAt" | "createdAt" | "updatedAt"> & {
	startsAt: string
	endsAt: string
	createdAt: string
	updatedAt: string
}

function toSlot(slot: SlotJson): ScheduleSlot {
	return {
		...slot,
		startsAt: new Date(slot.startsAt),
		endsAt: new Date(slot.endsAt),
		createdAt: new Date(slot.createdAt),
		updatedAt: new Date(slot.updatedAt),
	}
}

export const scheduleKeys = {
	all: ["schedules"] as const,
	slots: (request: ListSlotsRequest) =>
		["schedules", "slots", request.serviceId, request.locationId, request.month] as const,
}

/** A month of slots for one service at one location. Waits until both are chosen. */
export function useScheduleSlotsQuery(request: {
	serviceId: number | null
	locationId: number | null
	month: string
}) {
	const { serviceId, locationId, month } = request
	return useQuery({
		queryKey: scheduleKeys.slots({ serviceId: serviceId ?? 0, locationId: locationId ?? 0, month }),
		enabled: serviceId !== null && locationId !== null,
		queryFn: async () => {
			const query = new URLSearchParams({
				serviceId: String(serviceId),
				locationId: String(locationId),
				month,
			})
			const slots = await apiFetch<SlotJson[]>(`/schedules/slots?${query.toString()}`)
			return slots.map(toSlot)
		},
	})
}

function useRefreshScheduleQueries() {
	const queryClient = useQueryClient()
	return () => {
		void queryClient.invalidateQueries({ queryKey: scheduleKeys.all })
	}
}

export function useGenerateSlotsMutation() {
	const refresh = useRefreshScheduleQueries()
	return useMutation({
		mutationFn: (input: GenerateSlotsInput) =>
			apiFetch<GenerateSlotsResponse>("/schedules/slots/generate", {
				method: "POST",
				body: JSON.stringify(input),
			}),
		onSuccess: refresh,
	})
}

export function useUpdateSlotCapacityMutation() {
	const refresh = useRefreshScheduleQueries()
	return useMutation({
		mutationFn: async ({ id, capacity }: UpdateSlotCapacityRequest) =>
			toSlot(
				await apiFetch<SlotJson>(`/schedules/slots/${id}`, {
					method: "PUT",
					body: JSON.stringify({ capacity }),
				})
			),
		onSuccess: refresh,
	})
}

export function useSetSlotDisabledMutation() {
	const refresh = useRefreshScheduleQueries()
	return useMutation({
		mutationFn: async ({ id, isDisabled }: SetSlotDisabledRequest) =>
			toSlot(
				await apiFetch<SlotJson>(`/schedules/slots/${id}/disabled`, {
					method: "PUT",
					body: JSON.stringify({ isDisabled }),
				})
			),
		onSuccess: refresh,
	})
}

export function useDeleteSlotMutation() {
	const refresh = useRefreshScheduleQueries()
	return useMutation({
		mutationFn: (id: number) =>
			apiFetch<{ success: boolean; id: number }>(`/schedules/slots/${id}`, { method: "DELETE" }),
		onSuccess: refresh,
	})
}
