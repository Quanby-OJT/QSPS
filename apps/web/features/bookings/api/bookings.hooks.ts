"use client"

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"

import type { Booking, BookingForm, CreateBookingInput, FormUpload } from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

/** JSON turns dates into text; this is a Booking as it arrives. */
export type BookingJson = Omit<Booking, "holdExpiresAt" | "cancelledAt" | "createdAt" | "items"> & {
	holdExpiresAt: string | null
	cancelledAt: string | null
	createdAt: string
	items: (Omit<Booking["items"][number], "startsAt" | "endsAt"> & {
		startsAt: string
		endsAt: string
	})[]
}

export function toBooking(booking: BookingJson): Booking {
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

/**
 * BKG-3: a refused checkout that names the slot at fault (full, disabled,
 * started, or a Service no longer bookable), so the wizard can ask for a new
 * slot for that one Service and keep the rest of the cart.
 */
export class BookingCheckoutError extends ApiError {
	constructor(
		status: number,
		message: string,
		readonly scheduleSlotId: number
	) {
		super(status, message)
	}
}

/**
 * FRM-2: a refused checkout because of one Service's answers. Either some
 * questions need fixing (`fieldErrors`, question id to message), or the
 * questionnaire changed while the client was booking (`formChanged`). The
 * slot itself is fine and stays in the cart.
 */
export class BookingFormError extends ApiError {
	constructor(
		status: number,
		message: string,
		readonly serviceId: number | null,
		readonly fieldErrors: Record<string, string>,
		readonly formChanged: boolean
	) {
		super(status, message)
	}
}

type ErrorBody = {
	message?: string
	error?: { message?: string }
	/** The API's error data, or oRPC's input validation issues. */
	data?: {
		scheduleSlotId?: unknown
		serviceId?: unknown
		fieldErrors?: unknown
		formChanged?: unknown
		issues?: { message?: string }[]
	}
}

function stringRecord(value: unknown): Record<string, string> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null
	const entries = Object.entries(value).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string"
	)
	return Object.fromEntries(entries)
}

/** The API's refusal as the matching error class (also used by the walk-in screen, PRC-2). */
export async function readError(response: Response): Promise<ApiError> {
	let message = `Request failed (${response.status})`
	let data: ErrorBody["data"]
	try {
		const body = (await response.json()) as ErrorBody
		message = body?.data?.issues?.[0]?.message ?? body?.message ?? body?.error?.message ?? message
		data = body?.data
	} catch {
		// Error bodies may be empty or non-JSON.
	}

	// FRM-2 first: these also carry the slot, but the slot is not the problem.
	const fieldErrors = stringRecord(data?.fieldErrors)
	const formChanged = data?.formChanged === true
	if (fieldErrors || formChanged) {
		return new BookingFormError(
			response.status,
			message,
			typeof data?.serviceId === "number" ? data.serviceId : null,
			fieldErrors ?? {},
			formChanged
		)
	}
	if (typeof data?.scheduleSlotId === "number") {
		return new BookingCheckoutError(response.status, message, data.scheduleSlotId)
	}
	return new ApiError(response.status, message)
}

/** The client's one booking awaiting payment (BKG-2). */
export const UNPAID_BOOKING_QUERY_KEY = ["bookings", "unpaid"] as const

export const bookingFormKeys = {
	all: ["bookings", "form"] as const,
	forService: (serviceId: number) => ["bookings", "form", serviceId] as const,
}

/**
 * Confirm a booking of one or more Services (BKG-3). A refusal that names a
 * slot arrives as a `BookingCheckoutError`; one about answers as a
 * `BookingFormError` (FRM-2).
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

/** What the wizard needs from the questionnaires of every Service in a checkout. */
export interface CheckoutForms {
	/** Service id to its active questionnaire, or null; undefined until every Service has answered. */
	data: ReadonlyMap<number, BookingForm | null> | undefined
	isPending: boolean
	isError: boolean
	isSuccess: boolean
	refetch: () => void
}

/**
 * FRM-2: the questionnaire of each Service in the cart. Always fresh, so the
 * client answers the version the API will check.
 */
export function useBookingFormsQuery(serviceIds: readonly number[]): CheckoutForms {
	return useQueries({
		queries: serviceIds.map(serviceId => ({
			queryKey: bookingFormKeys.forService(serviceId),
			queryFn: async (): Promise<BookingForm | null> => {
				const response = await fetch(`${API_BASE}/bookings/form?serviceId=${String(serviceId)}`, {
					credentials: "include",
				})
				if (!response.ok) throw await readError(response)
				return (await response.json()) as BookingForm | null
			},
			staleTime: 0,
			refetchOnMount: "always" as const,
		})),
		combine: results => {
			const isSuccess = results.every(result => result.isSuccess)
			return {
				data: isSuccess
					? new Map(serviceIds.map((serviceId, index) => [serviceId, results[index]?.data ?? null]))
					: undefined,
				isPending: results.some(result => result.isPending),
				isError: results.some(result => result.isError),
				isSuccess,
				refetch: () => {
					for (const result of results) {
						if (!result.isSuccess) void result.refetch()
					}
				},
			}
		},
	})
}

/** Where a client uploads a file answer for their own booking (FRM-2). */
export const BOOKING_FORM_UPLOAD_PATH = "/bookings/form-uploads"

/**
 * FRM-2: upload a file answer. The answer then holds the returned `fileKey`.
 * Sent as multipart form data, so no Content-Type header is set by hand.
 * `path` is the walk-in upload route when staff answer for a client (PRC-2).
 */
export function useUploadFormFileMutation(path: string = BOOKING_FORM_UPLOAD_PATH) {
	return useMutation({
		mutationFn: async (file: File): Promise<FormUpload> => {
			const body = new FormData()
			body.append("file", file)
			const response = await fetch(`${API_BASE}${path}`, {
				method: "POST",
				credentials: "include",
				body,
			})
			if (!response.ok) throw await readError(response)
			return (await response.json()) as FormUpload
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
