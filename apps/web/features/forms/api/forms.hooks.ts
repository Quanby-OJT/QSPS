"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	FormFieldInput,
	FormServiceSummary,
	FormTemplate,
	FormTemplateSummary,
} from "@repo/contracts"

import { ApiError } from "@/core/lib/api-error"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

type ErrorBody = {
	message?: string
	error?: { message?: string }
	/** oRPC input validation puts the field messages here. */
	data?: { issues?: { message?: string }[] }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const isWrite = init?.method !== undefined && init.method !== "GET"
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			// A retried click replays the first answer instead of writing twice.
			...(isWrite ? { "Idempotency-Key": crypto.randomUUID() } : {}),
			...init?.headers,
		},
	})

	if (!response.ok) {
		let message = `Request failed (${response.status})`
		try {
			const body = (await response.json()) as ErrorBody
			message = body?.data?.issues?.[0]?.message ?? body?.message ?? body?.error?.message ?? message
		} catch {
			// Error bodies may be empty or non-JSON.
		}
		throw new ApiError(response.status, message)
	}

	if (response.status === 204) {
		return undefined as T
	}
	return (await response.json()) as T
}

export const formKeys = {
	all: ["forms"] as const,
	services: () => [...formKeys.all, "services"] as const,
	versions: (serviceId: number) => [...formKeys.all, "versions", serviceId] as const,
	template: (templateId: number) => [...formKeys.all, "template", templateId] as const,
}

/** FRM-1: Services in Scope with their published and draft questionnaire. */
export function useFormServicesQuery() {
	return useQuery({
		queryKey: formKeys.services(),
		queryFn: () => apiFetch<FormServiceSummary[]>("/forms/services"),
	})
}

/** Every version of one Service's questionnaire, newest first. */
export function useFormVersionsQuery(serviceId: number) {
	return useQuery({
		queryKey: formKeys.versions(serviceId),
		queryFn: () => apiFetch<FormTemplateSummary[]>(`/forms/services/${serviceId}/templates`),
	})
}

/** One version with its questions. */
export function useFormTemplateQuery(templateId: number | null) {
	return useQuery({
		queryKey: formKeys.template(templateId ?? 0),
		queryFn: () => apiFetch<FormTemplate>(`/forms/templates/${templateId}`),
		enabled: templateId !== null,
	})
}

function useInvalidateForms() {
	const queryClient = useQueryClient()
	return (template?: FormTemplate) => {
		if (template) queryClient.setQueryData(formKeys.template(template.id), template)
		void queryClient.invalidateQueries({ queryKey: formKeys.all })
	}
}

export function useCreateDraftMutation() {
	const invalidate = useInvalidateForms()
	return useMutation({
		mutationFn: (serviceId: number) =>
			apiFetch<FormTemplate>(`/forms/services/${serviceId}/draft`, { method: "POST", body: "{}" }),
		onSuccess: template => invalidate(template),
	})
}

/** Saving on a published version answers with the new draft version. */
export function useSaveFieldsMutation() {
	const invalidate = useInvalidateForms()
	return useMutation({
		mutationFn: ({ templateId, fields }: { templateId: number; fields: FormFieldInput[] }) =>
			apiFetch<FormTemplate>(`/forms/templates/${templateId}/fields`, {
				method: "PUT",
				body: JSON.stringify({ fields }),
			}),
		onSuccess: template => invalidate(template),
	})
}

export function usePublishMutation() {
	const invalidate = useInvalidateForms()
	return useMutation({
		mutationFn: (templateId: number) =>
			apiFetch<FormTemplate>(`/forms/templates/${templateId}/publish`, {
				method: "POST",
				body: "{}",
			}),
		onSuccess: template => invalidate(template),
	})
}

export function useSetActiveMutation() {
	const invalidate = useInvalidateForms()
	return useMutation({
		mutationFn: ({ templateId, isActive }: { templateId: number; isActive: boolean }) =>
			apiFetch<FormTemplateSummary>(`/forms/templates/${templateId}/active`, {
				method: "PATCH",
				body: JSON.stringify({ isActive }),
			}),
		onSuccess: () => invalidate(),
	})
}

/** A version with submissions answers 409: offer to disable it instead. */
export function useDeleteTemplateMutation() {
	const invalidate = useInvalidateForms()
	return useMutation({
		mutationFn: (templateId: number) =>
			apiFetch<{ deleted: true }>(`/forms/templates/${templateId}`, { method: "DELETE" }),
		onSuccess: () => invalidate(),
	})
}
