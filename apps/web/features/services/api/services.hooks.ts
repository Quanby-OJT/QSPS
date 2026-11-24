"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type {
	CreateServiceInput,
	SaveServiceStepsInput,
	Service,
	ServiceCategory,
	ServiceSteps,
	UpdateServiceRequest,
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

export const serviceKeys = {
	categories: ["services", "categories"] as const,
	all: ["services", "all"] as const,
	available: ["services", "available"] as const,
	steps: (serviceId: number) => ["services", "steps", serviceId] as const,
}

export function useServiceCategoriesQuery() {
	return useQuery({
		queryKey: serviceKeys.categories,
		queryFn: () => apiFetch<ServiceCategory[]>("/services/categories"),
	})
}

export function useServicesQuery() {
	return useQuery({
		queryKey: serviceKeys.all,
		queryFn: () => apiFetch<Service[]>("/services"),
	})
}

export function useAvailableServicesQuery() {
	return useQuery({
		queryKey: serviceKeys.available,
		queryFn: () => apiFetch<Service[]>("/services/available"),
	})
}

function useRefreshServiceQueries() {
	const queryClient = useQueryClient()
	return () => {
		void queryClient.invalidateQueries({ queryKey: serviceKeys.all })
		void queryClient.invalidateQueries({ queryKey: serviceKeys.available })
	}
}

export function useCreateServiceMutation() {
	const refresh = useRefreshServiceQueries()
	return useMutation({
		mutationFn: (input: CreateServiceInput) =>
			apiFetch<Service>("/services", { method: "POST", body: JSON.stringify(input) }),
		onSuccess: refresh,
	})
}

export function useUpdateServiceMutation() {
	const refresh = useRefreshServiceQueries()
	return useMutation({
		mutationFn: ({ id, ...input }: UpdateServiceRequest) =>
			apiFetch<Service>(`/services/${id}`, { method: "PUT", body: JSON.stringify(input) }),
		onSuccess: refresh,
	})
}

export function useSetServiceActiveMutation() {
	const refresh = useRefreshServiceQueries()
	return useMutation({
		mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
			apiFetch<Service>(`/services/${id}/active`, {
				method: "PUT",
				body: JSON.stringify({ isActive }),
			}),
		onSuccess: refresh,
	})
}

/** PRC-4: a Service's steps, each with its result form. */
export function useServiceStepsQuery(serviceId: number) {
	return useQuery({
		queryKey: serviceKeys.steps(serviceId),
		queryFn: () => apiFetch<ServiceSteps>(`/services/${serviceId}/steps`),
	})
}

/** PRC-4: replace a Service's steps with an ordered list. */
export function useSaveServiceStepsMutation(serviceId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ steps }: Pick<SaveServiceStepsInput, "steps">) =>
			apiFetch<ServiceSteps>(`/services/${serviceId}/steps`, {
				method: "PUT",
				body: JSON.stringify({ steps }),
			}),
		onSuccess: saved => {
			queryClient.setQueryData(serviceKeys.steps(serviceId), saved)
			// Open assessments show the new steps on their next read.
			void queryClient.invalidateQueries({ queryKey: ["processing"] })
		},
	})
}
