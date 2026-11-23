"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	ApprovalDecision,
	ApprovalQueue,
	ApprovalQueueView,
	AssessmentOutcome,
	CheckInResponse,
	IcvIssueDetails,
	ProcessingItem,
	ProcessingQueue,
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

/** JSON turns dates into text; these types are the responses as they arrive. */
type QueueJson = Omit<ProcessingQueue, "items"> & {
	items: (Omit<ProcessingQueue["items"][number], "startsAt" | "endsAt"> & {
		startsAt: string
		endsAt: string
	})[]
}

type ItemJson = Omit<ProcessingItem, "startsAt" | "endsAt" | "assessments"> & {
	startsAt: string
	endsAt: string
	assessments: (Omit<ProcessingItem["assessments"][number], "createdAt"> & {
		createdAt: string
	})[]
}

function toQueue(queue: QueueJson): ProcessingQueue {
	return {
		...queue,
		items: queue.items.map(item => ({
			...item,
			startsAt: new Date(item.startsAt),
			endsAt: new Date(item.endsAt),
		})),
	}
}

function toItem(item: ItemJson): ProcessingItem {
	return {
		...item,
		startsAt: new Date(item.startsAt),
		endsAt: new Date(item.endsAt),
		assessments: item.assessments.map(assessment => ({
			...assessment,
			createdAt: new Date(assessment.createdAt),
		})),
	}
}

export const processingKeys = {
	all: ["processing"] as const,
	queue: (date: string) => ["processing", "queue", date] as const,
	item: (bookingItemId: number) => ["processing", "item", bookingItemId] as const,
	approvals: (view: ApprovalQueueView) => ["processing", "approvals", view] as const,
}

type ApprovalQueueJson = Omit<ApprovalQueue, "items"> & {
	items: (Omit<ApprovalQueue["items"][number], "startsAt" | "assessedAt"> & {
		startsAt: string
		assessedAt: string | null
	})[]
}

function toApprovalQueue(queue: ApprovalQueueJson): ApprovalQueue {
	return {
		...queue,
		items: queue.items.map(item => ({
			...item,
			startsAt: new Date(item.startsAt),
			assessedAt: item.assessedAt ? new Date(item.assessedAt) : null,
		})),
	}
}

/** PRC-3: items waiting for head approval, or rejected items to override. Refreshes every 30 seconds. */
export function useApprovalQueueQuery(view: ApprovalQueueView) {
	return useQuery({
		queryKey: processingKeys.approvals(view),
		queryFn: async () =>
			toApprovalQueue(await apiFetch<ApprovalQueueJson>(`/processing/approvals?view=${view}`)),
		refetchInterval: 30_000,
	})
}

/** The day's queue at the signed-in staff user's Location. Refreshes every 30 seconds. */
export function useProcessingQueueQuery(date: string) {
	return useQuery({
		queryKey: processingKeys.queue(date),
		queryFn: async () =>
			toQueue(await apiFetch<QueueJson>(`/processing/queue?date=${encodeURIComponent(date)}`)),
		refetchInterval: 30_000,
	})
}

export function useProcessingItemQuery(bookingItemId: number) {
	return useQuery({
		queryKey: processingKeys.item(bookingItemId),
		queryFn: async () => toItem(await apiFetch<ItemJson>(`/processing/items/${bookingItemId}`)),
	})
}

/** Check a client in by the Reference Number from their QR code. */
export function useCheckInMutation() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async (referenceNumber: string): Promise<CheckInResponse> => {
			const response = await apiFetch<{ items: ItemJson[] }>("/processing/check-in", {
				method: "POST",
				headers: { "Idempotency-Key": crypto.randomUUID() },
				body: JSON.stringify({ referenceNumber }),
			})
			return { items: response.items.map(toItem) }
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: processingKeys.all })
		},
	})
}

/** Start assessing a checked-in (or returned) item. */
export function useOpenItemMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async () =>
			toItem(
				await apiFetch<ItemJson>(`/processing/items/${bookingItemId}/open`, {
					method: "POST",
					headers: { "Idempotency-Key": crypto.randomUUID() },
					body: JSON.stringify({}),
				})
			),
		onSuccess: item => {
			queryClient.setQueryData(processingKeys.item(bookingItemId), item)
			void queryClient.invalidateQueries({ queryKey: ["processing", "queue"] })
		},
	})
}

export interface RecordAssessmentRequest {
	outcome: AssessmentOutcome
	notes: string
	corrections: Record<string, string>
	/** Certificate details, sent when clearing an item whose Service auto-issues (CRT-1). */
	document?: IcvIssueDetails | null
	/** One per submit attempt, so a double click adds one Assessment, not two. */
	idempotencyKey: string
}

export function useRecordAssessmentMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({ idempotencyKey, ...body }: RecordAssessmentRequest) =>
			toItem(
				await apiFetch<ItemJson>(`/processing/items/${bookingItemId}/assessments`, {
					method: "POST",
					headers: { "Idempotency-Key": idempotencyKey },
					body: JSON.stringify(body),
				})
			),
		onSuccess: item => {
			queryClient.setQueryData(processingKeys.item(bookingItemId), item)
			void queryClient.invalidateQueries({ queryKey: ["processing", "queue"] })
			// A cleared item may have just issued a document (CRT-1).
			void queryClient.invalidateQueries({ queryKey: ["certificates"] })
		},
	})
}

export interface DecideApprovalRequest {
	decision: ApprovalDecision
	notes: string
	/** Certificate details, when this makes the item cleared and the Service auto-issues (CRT-1a). */
	document?: IcvIssueDetails | null
	/** One per decision, so a double click records one decision, not two. */
	idempotencyKey: string
}

/** PRC-3: approve a pending item, or send it back to the officer with notes. */
export function useDecideApprovalMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({ idempotencyKey, ...body }: DecideApprovalRequest) =>
			toItem(
				await apiFetch<ItemJson>(`/processing/items/${bookingItemId}/approval`, {
					method: "POST",
					headers: { "Idempotency-Key": idempotencyKey },
					body: JSON.stringify(body),
				})
			),
		onSuccess: item => {
			queryClient.setQueryData(processingKeys.item(bookingItemId), item)
			void queryClient.invalidateQueries({ queryKey: ["processing", "approvals"] })
			// CRT-1a: approving or overriding may have just issued a document.
			void queryClient.invalidateQueries({ queryKey: ["certificates"] })
			void queryClient.invalidateQueries({ queryKey: ["processing", "queue"] })
		},
	})
}

export interface OverrideItemRequest {
	reason: string
	/** Certificate details, when this makes the item cleared and the Service auto-issues (CRT-1a). */
	document?: IcvIssueDetails | null
	idempotencyKey: string
}

/** PRC-3: override a rejected item to cleared, with a mandatory reason. */
export function useOverrideItemMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({ idempotencyKey, ...body }: OverrideItemRequest) =>
			toItem(
				await apiFetch<ItemJson>(`/processing/items/${bookingItemId}/override`, {
					method: "POST",
					headers: { "Idempotency-Key": idempotencyKey },
					body: JSON.stringify(body),
				})
			),
		onSuccess: item => {
			queryClient.setQueryData(processingKeys.item(bookingItemId), item)
			void queryClient.invalidateQueries({ queryKey: ["processing", "approvals"] })
			// CRT-1a: approving or overriding may have just issued a document.
			void queryClient.invalidateQueries({ queryKey: ["certificates"] })
			void queryClient.invalidateQueries({ queryKey: ["processing", "queue"] })
		},
	})
}

/** FRM-2c: a client's uploaded answer file, for staff. Opened by the browser with the staff session cookie. */
export function answerFileUrl(bookingItemId: number, fieldId: number): string {
	return `${API_BASE}/processing/items/${bookingItemId}/answers/${fieldId}/file`
}
