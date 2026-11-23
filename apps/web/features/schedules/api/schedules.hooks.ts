"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	BlockScheduleDateRequest,
	BlockScheduleDateResponse,
	BulkUpdateCapacityRequest,
	BulkUpdateCapacityResponse,
	GenerateSlotsInput,
	GenerateSlotsResponse,
	ListSlotsRequest,
	ScheduleSlot,
	SetSlotDisabledRequest,
	SlotAvailability,
	UnblockScheduleDateRequest,
	UnblockScheduleDateResponse,
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
			const body = (await response.json()) as {
				message?: string
				error?: { message?: string }
				/** oRPC input validation puts the field messages here. */
				data?: { issues?: { message?: string }[] }
			}
			message = body?.data?.issues?.[0]?.message ?? body?.message ?? body?.error?.message ?? message
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

/** The same shape with every `startsAt` still as JSON text. */
type WithStartsAtText<T extends { startsAt: Date }> = Omit<T, "startsAt"> & { startsAt: string }

type BulkUpdateCapacityJson = Omit<BulkUpdateCapacityResponse, "skipped"> & {
	skipped: WithStartsAtText<BulkUpdateCapacityResponse["skipped"][number]>[]
}

type BlockScheduleDateJson = Omit<BlockScheduleDateResponse, "paidBookings"> & {
	paidBookings: WithStartsAtText<BlockScheduleDateResponse["paidBookings"][number]>[]
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

type AvailabilityJson = Omit<SlotAvailability, "startsAt" | "endsAt"> & {
	startsAt: string
	endsAt: string
}

/**
 * What a client can book: each slot's remaining capacity for one service at
 * one location in a month. Waits until both are chosen.
 */
export function useSlotAvailabilityQuery(request: {
	serviceId: number | null
	locationId: number | null
	month: string
}) {
	const { serviceId, locationId, month } = request
	return useQuery({
		queryKey: ["schedules", "availability", serviceId, locationId, month] as const,
		enabled: serviceId !== null && locationId !== null,
		queryFn: async (): Promise<SlotAvailability[]> => {
			const query = new URLSearchParams({
				serviceId: String(serviceId),
				locationId: String(locationId),
				month,
			})
			const slots = await apiFetch<AvailabilityJson[]>(
				`/schedules/availability?${query.toString()}`
			)
			return slots.map(slot => ({
				...slot,
				startsAt: new Date(slot.startsAt),
				endsAt: new Date(slot.endsAt),
			}))
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

/** SCH-2: one capacity for every slot in a day, week or month. */
export function useBulkUpdateCapacityMutation() {
	const refresh = useRefreshScheduleQueries()
	return useMutation({
		mutationFn: async (input: BulkUpdateCapacityRequest): Promise<BulkUpdateCapacityResponse> => {
			const result = await apiFetch<BulkUpdateCapacityJson>("/schedules/slots/capacity/bulk", {
				method: "PUT",
				body: JSON.stringify(input),
			})
			return {
				...result,
				skipped: result.skipped.map(slot => ({ ...slot, startsAt: new Date(slot.startsAt) })),
			}
		},
		onSuccess: refresh,
	})
}

/** SCH-2: disable a whole date, returning the paid Bookings to follow up. */
export function useBlockScheduleDateMutation() {
	const refresh = useRefreshScheduleQueries()
	return useMutation({
		mutationFn: async (input: BlockScheduleDateRequest): Promise<BlockScheduleDateResponse> => {
			const result = await apiFetch<BlockScheduleDateJson>("/schedules/dates/block", {
				method: "POST",
				body: JSON.stringify(input),
			})
			return {
				...result,
				paidBookings: result.paidBookings.map(booking => ({
					...booking,
					startsAt: new Date(booking.startsAt),
				})),
			}
		},
		onSuccess: refresh,
	})
}

/** SCH-2: re-enable the slots a date block disabled. */
export function useUnblockScheduleDateMutation() {
	const refresh = useRefreshScheduleQueries()
	return useMutation({
		mutationFn: (input: UnblockScheduleDateRequest) =>
			apiFetch<UnblockScheduleDateResponse>("/schedules/dates/unblock", {
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
