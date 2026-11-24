"use client"

import { useMutation, useQuery } from "@tanstack/react-query"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/**
 * Ask for a printout and show the PDF in `target`, a tab that the click
 * opened (CRT-4). Open the tab before awaiting, from the click itself, or
 * pop-up blockers refuse it. The PDF opens in the browser's viewer, from
 * which it is printed.
 */
async function openPrintout(path: string, target: Window | null): Promise<void> {
	const response = await fetch(`${API_BASE}${path}`, {
		method: "POST",
		credentials: "include",
	})
	if (!response.ok) {
		target?.close()
		let message = `Print failed (${response.status})`
		try {
			const body = (await response.json()) as { message?: string }
			if (body?.message) message = body.message
		} catch {
			// Error bodies may be empty or non-JSON.
		}
		throw new ApiError(response.status, message)
	}
	const url = URL.createObjectURL(await response.blob())
	if (target) {
		target.location.href = url
	} else {
		window.open(url, "_blank")
	}
	// Let the tab load the PDF before the address is released.
	setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Staff print the Physical Examination application form for a Booking Item. */
export function usePrintApplicationFormMutation() {
	return useMutation({
		mutationFn: ({ bookingItemId, target }: { bookingItemId: number; target: Window | null }) =>
			openPrintout(
				`/certificates/printouts/booking-items/${bookingItemId}/application-form/print`,
				target
			),
	})
}

/** Staff print the Request for Payment for a Booking awaiting payment. */
export function usePrintRequestForPaymentMutation() {
	return useMutation({
		mutationFn: ({ bookingId, target }: { bookingId: number; target: Window | null }) =>
			openPrintout(
				`/certificates/printouts/bookings/${bookingId}/request-for-payment/print`,
				target
			),
	})
}

/**
 * Where a client downloads their own application form. A plain link: the
 * browser sends the session cookie, and the API answers 404 for anyone else.
 */
export function applicationFormDownloadUrl(bookingItemId: number): string {
	return `${API_BASE}/certificates/printouts/booking-items/${bookingItemId}/application-form`
}

/** One application form a client can download for their own Booking. */
export interface ApplicationFormLink {
	bookingItemId: number
	serviceName: string
}

/**
 * The application forms the signed-in client can download for one of their
 * own Bookings (CRT-4). Empty when the Booking has none; an error (for
 * example 404) just means no links are shown.
 */
export function useApplicationFormsQuery(bookingId: number) {
	return useQuery({
		queryKey: ["certificates", "application-forms", bookingId] as const,
		queryFn: async (): Promise<ApplicationFormLink[]> => {
			const response = await fetch(
				`${API_BASE}/certificates/printouts/bookings/${bookingId}/application-forms`,
				{ credentials: "include" }
			)
			if (!response.ok) {
				throw new ApiError(
					response.status,
					`Could not load the application forms (${response.status})`
				)
			}
			const body = (await response.json()) as { items: ApplicationFormLink[] }
			return body.items
		},
	})
}
