"use client"

import Link from "next/link"
import { File01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/core/components/ui/empty"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import { cn } from "@/core/lib/utils"
import { useFormServicesQuery } from "@/features/forms/api/forms.hooks"

/** FRM-1: every Service in Scope and the state of its questionnaire. */
export function FormsOverview() {
	const query = useFormServicesQuery()
	const hydrated = useHydrated()
	const forbidden = query.error instanceof ApiError && query.error.status === 403

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={File01Icon}
				title="Forms"
				description="The questionnaire a client answers when booking each service. Changes are kept as versions and recorded in the audit log."
			/>

			{forbidden ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<HugeiconsIcon icon={File01Icon} strokeWidth={2} />
						</EmptyMedia>
						<EmptyTitle>You do not have access to forms</EmptyTitle>
						<EmptyDescription>
							Building questionnaires needs the forms.templates:manage permission. Ask an
							administrator if you need it. This attempt has been recorded.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : !hydrated || query.isPending ? (
				<div className="flex flex-col gap-3" role="status" aria-label="Loading forms">
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
					<Skeleton className="h-16 w-full rounded-xl" />
				</div>
			) : query.isError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load forms.</p>
					<p className="text-muted-foreground mt-1 text-sm">{query.error.message}</p>
					<Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
						Retry
					</Button>
				</div>
			) : query.data.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>No services yet</EmptyTitle>
						<EmptyDescription>
							Add a service first, then build its questionnaire here.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="bg-card divide-y rounded-xl border">
					{query.data.map(service => (
						<li
							key={service.serviceId}
							className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0">
								<p className="font-semibold">{service.serviceName}</p>
								<div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
									<span>{service.serviceCode}</span>
									{service.published ? (
										<Badge variant={service.published.isActive ? "default" : "secondary"}>
											Version {service.published.version}{" "}
											{service.published.isActive ? "published" : "disabled"}
										</Badge>
									) : (
										<Badge variant="outline">No published form</Badge>
									)}
									{service.draft ? (
										<Badge variant="secondary">Draft version {service.draft.version}</Badge>
									) : null}
								</div>
							</div>
							<Link
								href={`/forms/${service.serviceId}`}
								className={cn(
									buttonVariants({ variant: "outline", size: "sm" }),
									"self-start sm:self-auto"
								)}
							>
								{service.published || service.draft ? "Open builder" : "Build form"}
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	)
}
