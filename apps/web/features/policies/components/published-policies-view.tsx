"use client"

import { File01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { PageHeader } from "@/core/components/page-header"
import { Button } from "@/core/components/ui/button"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/core/components/ui/empty"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { usePublishedPoliciesQuery } from "@/features/policies/api/policy-documents.hooks"
import { PolicyText } from "@/features/policies/components/policy-text"
import { appliesToLabel, formatPolicyDate } from "@/features/policies/lib/policy-documents"

/**
 * ADM-9: the written policies in effect today, open to anyone, so a client can
 * read BOQ's terms before signing up or booking.
 */
export function PublishedPoliciesView() {
	const query = usePublishedPoliciesQuery()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const loading = !hydrated || isQueryLoading(query)

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={File01Icon}
				title="Terms and policies"
				description="The Bureau of Quarantine policies that apply when you book a service."
			/>

			{loading ? (
				<div className="flex flex-col gap-3" role="status" aria-label="Loading policies">
					<Skeleton className="h-40 w-full rounded-xl" />
					<Skeleton className="h-40 w-full rounded-xl" />
				</div>
			) : query.isError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load the policies.</p>
					<Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
						Retry
					</Button>
				</div>
			) : !query.data || query.data.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<HugeiconsIcon icon={File01Icon} strokeWidth={2} />
						</EmptyMedia>
						<EmptyTitle>No policies published</EmptyTitle>
						<EmptyDescription>
							The Bureau of Quarantine has not published any booking policies yet.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				query.data.map(policy => (
					<article
						key={policy.id}
						className="bg-card rounded-xl border p-4"
						aria-labelledby={`policy-${policy.id}`}
					>
						<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
						<h2 id={`policy-${policy.id}`} className="text-lg font-bold tracking-tight">
							{policy.title}
						</h2>
						<p className="text-muted-foreground mt-1 text-xs">
							{appliesToLabel(policy)} · in effect since {formatPolicyDate(policy.effectiveFrom)} ·
							version {policy.version}
							{policy.requiresAcceptance ? " · you accept it when you book" : null}
						</p>
						<PolicyText body={policy.body} className="mt-3" />
					</article>
				))
			)}
		</section>
	)
}
