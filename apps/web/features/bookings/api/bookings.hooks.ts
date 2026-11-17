"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import type { Booking, CreateBookingInput } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** JSON turns dates into text; this is a Booking as it arrives. */
type BookingJson = Omit<Booking, "holdExpiresAt" | "createdAt" | "items"> & {
	holdExpiresAt: string | null
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
		createdAt: new Date(booking.createdAt),
		items: booking.items.map(item => ({
			...item,
			startsAt: new Date(item.startsAt),
			endsAt: new Date(item.endsAt),
		})),
	}
}

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

			if (!response.ok) {
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
				throw new ApiError(response.status, message)
			}

			return toBooking((await response.json()) as BookingJson)
		},
		// A place was taken, so availability shown anywhere is now out of date.
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["schedules"] })
		},
	})
}
