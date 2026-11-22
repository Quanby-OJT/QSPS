"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { Booking, CreateBookingInput } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** JSON turns dates into text; this is a Booking as it arrives. */
type BookingJson = Omit<Booking, "holdExpiresAt" | "cancelledAt" | "createdAt" | "items"> & {
	holdExpiresAt: string | null
	cancelledAt: string | null
	createdAt: string
	items: (Omit<Booking["items"][number], "startsAt" | "endsAt"> & {
		startsAt: string
		endsAt: string
	})[]
}

function toBooking(booking: BookingJson): Booking {
	return {
		...booking,
		holdExpiresAt: booking.holdExpiresAt ? new Date(booking.holdExpiresAt) : null,
		cancelledAt: booking.cancelledAt ? new Date(booking.cancelledAt) : null,
		createdAt: new Date(booking.createdAt),
		items: booking.items.map(item => ({
			...item,
			startsAt: new Date(item.startsAt),
			endsAt: new Date(item.endsAt),
		})),
	}
}

async function readError(response: Response): Promise<ApiError> {
	let message = `Request failed (${response.status})`
	try {
		const body = (await response.json()) as {
			message?: string
			error?: { message?: string }
		}
		message = body?.message ?? body?.error?.message ?? message
	} catch {
		// Error bodies may be empty or non-JSON.
	}
	return new ApiError(response.status, message)
}

/** The client's one booking awaiting payment (BKG-2). */
export const UNPAID_BOOKING_QUERY_KEY = ["bookings", "unpaid"] as const

/**
 * Confirm a booking.
 *
 * `idempotencyKey` identifies one attempt: sending the same key again (a
 * double click, or a retry after a dropped connection) returns the first
 * booking instead of taking a second place.
 */
export function useCreateBookingMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({
			idempotencyKey,
			...input
		}: CreateBookingInput & { idempotencyKey: string }): Promise<Booking> => {
			const response = await fetch(`${API_BASE}/bookings`, {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
				},
				body: JSON.stringify(input),
			})
			if (!response.ok) throw await readError(response)
			return toBooking((await response.json()) as BookingJson)
		},
		// A place was taken, so availability shown anywhere is now out of date,
		// and the client now has a booking awaiting payment.
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["schedules"] })
			void queryClient.invalidateQueries({ queryKey: UNPAID_BOOKING_QUERY_KEY })
		},
	})
}

/**
 * The client's booking awaiting payment, or null (BKG-2). Only asked for
 * when the caller may read their own bookings, so a refused request never
 * reaches the audit log.
 */
export function useUnpaidBookingQuery(enabled: boolean) {
	return useQuery({
		queryKey: UNPAID_BOOKING_QUERY_KEY,
		enabled,
		queryFn: async (): Promise<Booking | null> => {
			const response = await fetch(`${API_BASE}/bookings/unpaid`, { credentials: "include" })
			if (!response.ok) throw await readError(response)
			const body = (await response.json()) as BookingJson | null
			return body ? toBooking(body) : null
		},
	})
}

/** A write on one booking, sent once per `idempotencyKey`. */
function useBookingAction(action: "cancel" | "pay-onsite") {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({
			bookingId,
			idempotencyKey,
		}: {
			bookingId: number
			idempotencyKey: string
		}): Promise<Booking> => {
			const response = await fetch(`${API_BASE}/bookings/${bookingId}/${action}`, {
				method: "POST",
				credentials: "include",
				headers: { "Idempotency-Key": idempotencyKey },
			})
			if (!response.ok) throw await readError(response)
			return toBooking((await response.json()) as BookingJson)
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: UNPAID_BOOKING_QUERY_KEY })
			// A cancelled booking gives its place back.
			if (action === "cancel") void queryClient.invalidateQueries({ queryKey: ["schedules"] })
		},
	})
}

/** Cancel the client's own unpaid booking (BKG-2, bookings.own:cancel). */
export function useCancelBookingMutation() {
	return useBookingAction("cancel")
}

/** Pay at the BOQ cashier instead of online (BKG-2). */
export function usePayOnsiteMutation() {
	return useBookingAction("pay-onsite")
}
