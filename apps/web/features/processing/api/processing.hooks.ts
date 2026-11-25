"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	ApprovalDecision,
	ApprovalQueue,
	ApprovalQueueView,
	AssessmentOutcome,
	BiologicalCertificationDetails,
	BiologicalPermitDetails,
	CheckInResponse,
	DocumentSummary,
	FormAnswers,
	HaccpDetails,
	HumanRemainsDetails,
	IcvIssueDetails,
	ItemStep,
	MedicalExemptionDetails,
	ProcessingItem,
	ProcessingQueue,
	SanitaryPermitDetails,
	ShipSanitationDetails,
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

type StepResultJson = Omit<NonNullable<ItemStep["result"]>, "recordedAt"> & { recordedAt: string }

type ItemJson = Omit<ProcessingItem, "startsAt" | "endsAt" | "assessments" | "steps"> & {
	startsAt: string
	endsAt: string
	assessments: (Omit<ProcessingItem["assessments"][number], "createdAt"> & {
		createdAt: string
	})[]
	/** PRC-4. Missing from an item cached before steps existed. */
	steps?: (Omit<ItemStep, "result" | "history"> & {
		result: StepResultJson | null
		history: StepResultJson[]
	})[]
}

function toStepResult(result: StepResultJson): NonNullable<ItemStep["result"]> {
	return { ...result, recordedAt: new Date(result.recordedAt) }
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
		steps: (item.steps ?? []).map(step => ({
			...step,
			result: step.result ? toStepResult(step.result) : null,
			history: step.history.map(toStepResult),
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
	/** CRT-3: the client is medically exempt; a Medical Exemption Certificate is issued instead. */
	exemption?: MedicalExemptionDetails | null
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
	/** CRT-3: the client is medically exempt; the Medical Exemption Certificate is issued instead. */
	exemption?: MedicalExemptionDetails | null
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
	/** CRT-3: the client is medically exempt; the Medical Exemption Certificate is issued instead. */
	exemption?: MedicalExemptionDetails | null
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

export interface IssueDocumentRequest {
	/** The vaccination record's details, or null when issuing an exemption. */
	details: IcvIssueDetails | null
	/** CRT-3: issue a Medical Exemption Certificate instead of the vaccination record. */
	exemption: MedicalExemptionDetails | null
	/** CRT-5: issue a Sanitary Permit. */
	sanitaryPermit?: SanitaryPermitDetails | null
	/** CRT-5: issue a Ship Sanitation Certificate. */
	shipSanitation?: ShipSanitationDetails | null
	/** CRT-6: issue a HACCP Certificate. */
	haccp?: HaccpDetails | null
	/** CRT-7: issue a Human Remains Certificate. Nothing to enter: send an empty object. */
	humanRemains?: HumanRemainsDetails | null
	/** CRT-7: issue a Biological Substance Certification. Nothing to enter: send an empty object. */
	biologicalCertification?: BiologicalCertificationDetails | null
	/** CRT-7: issue a Biological Substance Permit, with its validity. */
	biologicalPermit?: BiologicalPermitDetails | null
	idempotencyKey: string
}

/**
 * Issue the document for a cleared item as a separate step (CRT-1, CRT-3, CRT-5):
 * Services with auto-issue off, and items cleared after head approval.
 */
export function useIssueDocumentMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ idempotencyKey, ...body }: IssueDocumentRequest) =>
			apiFetch<DocumentSummary>(`/certificates/items/${bookingItemId}/documents`, {
				method: "POST",
				headers: { "Idempotency-Key": idempotencyKey },
				body: JSON.stringify(body),
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: processingKeys.item(bookingItemId) })
			void queryClient.invalidateQueries({ queryKey: ["processing", "queue"] })
			void queryClient.invalidateQueries({ queryKey: ["certificates"] })
		},
	})
}

/**
 * Print a document (CRT-3). Every call is counted and audited, so this is a
 * POST; the PDF comes back as bytes and opens in a new tab, where the
 * browser's print dialog sends it to the card printer. The vaccination
 * record comes laid out for the pre-printed yellow card.
 *
 * Open the tab before awaiting, from the click itself, or pop-up blockers
 * refuse it.
 */
export function usePrintDocumentMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({
			documentId,
			target,
		}: {
			documentId: number
			/** A tab opened by the click; the PDF is shown there. */
			target: Window | null
		}): Promise<{ printCount: number }> => {
			const response = await fetch(`${API_BASE}/certificates/documents/${documentId}/print`, {
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
			return { printCount: Number(response.headers.get("X-Print-Count") ?? 0) }
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: processingKeys.item(bookingItemId) })
		},
	})
}

/** FRM-2c: a client's uploaded answer file, for staff. Opened by the browser with the staff session cookie. */
export function answerFileUrl(bookingItemId: number, fieldId: number): string {
	return `${API_BASE}/processing/items/${bookingItemId}/answers/${fieldId}/file`
}

export interface RecordStepResultRequest {
	stepId: number
	/** The result form version the answers are for. */
	formTemplateId: number
	answers: FormAnswers
	/** One per save, so a double click records one result, not two. */
	idempotencyKey: string
}

/**
 * PRC-4: record a step's result, or correct it. A correction is stored as the
 * next version; the earlier one is kept.
 */
export function useRecordStepResultMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: async ({ stepId, idempotencyKey, ...body }: RecordStepResultRequest) =>
			toItem(
				await apiFetch<ItemJson>(`/processing/items/${bookingItemId}/steps/${stepId}/results`, {
					method: "POST",
					headers: { "Idempotency-Key": idempotencyKey },
					body: JSON.stringify(body),
				})
			),
		onSuccess: item => {
			queryClient.setQueryData(processingKeys.item(bookingItemId), item)
		},
	})
}

/**
 * PRC-4: a printable copy of a step's result (the current one, or `version`).
 * Opened by the browser with the staff session cookie, like answer files.
 */
export function stepResultPdfUrl(bookingItemId: number, stepId: number, version?: number): string {
	const query = version === undefined ? "" : `?version=${version}`
	return `${API_BASE}/processing/items/${bookingItemId}/steps/${stepId}/result.pdf${query}`
}

/** CRT-8: everything that shows the item's document changes after a revoke or reissue. */
function invalidateDocument(queryClient: ReturnType<typeof useQueryClient>, bookingItemId: number) {
	void queryClient.invalidateQueries({ queryKey: processingKeys.item(bookingItemId) })
	void queryClient.invalidateQueries({ queryKey: ["processing", "queue"] })
	void queryClient.invalidateQueries({ queryKey: ["certificates"] })
}

/** CRT-8: withdraw a document. The reason is required and kept in the audit. */
export function useRevokeDocumentMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ documentId, reason }: { documentId: number; reason: string }) =>
			apiFetch<DocumentSummary>(`/certificates/documents/${documentId}/revoke`, {
				method: "POST",
				body: JSON.stringify({ reason }),
			}),
		onSuccess: () => invalidateDocument(queryClient, bookingItemId),
	})
}

export interface ReissueDocumentRequest {
	documentId: number
	reason: string
	/** The corrected vaccination record, or null for a Medical Exemption Certificate. */
	details: IcvIssueDetails | null
	/** The corrected exemption, or null for a vaccination record. */
	exemption: MedicalExemptionDetails | null
}

/** CRT-8: replace a document with a corrected one. Answers with the new document. */
export function useReissueDocumentMutation(bookingItemId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ documentId, ...body }: ReissueDocumentRequest) =>
			apiFetch<DocumentSummary>(`/certificates/documents/${documentId}/reissue`, {
				method: "POST",
				body: JSON.stringify(body),
			}),
		onSuccess: () => invalidateDocument(queryClient, bookingItemId),
	})
}
