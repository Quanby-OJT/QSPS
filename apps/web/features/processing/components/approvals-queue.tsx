"use client"

import { useState } from "react"
import type { Route } from "next"
import Link from "next/link"

import type { ApprovalQueueView } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { buttonVariants } from "@/core/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { cn } from "@/core/lib/utils"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { useApprovalQueueQuery } from "@/features/processing/api/processing.hooks"
import { manilaDateKey } from "@/features/schedules/lib/calendar"

const VIEWS: { value: ApprovalQueueView; label: string; empty: string }[] = [
	{
		value: "pending",
		label: "Waiting for approval",
		empty: "Nothing is waiting for your approval.",
	},
	{
		value: "rejected",
		label: "Rejected (override)",
		empty: "No rejected items in your scope.",
	},
]

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
	timeZone: "Asia/Manila",
	dateStyle: "medium",
	timeStyle: "short",
})

/**
 * Head approval queue (PRC-3, Annex A): cleared items for Services that need
 * the head's sign-off, and rejected items the head may override. Only items
 * inside the caller's Scope are listed.
 *
 * Hydration-safe: the list shows its loading line on the server and on the
 * client's first render, even when the client already holds a restored copy,
 * so the two renders agree.
 */
export function ApprovalsQueue() {
	const [view, setView] = useState<ApprovalQueueView>("pending")
	const queue = useApprovalQueueQuery(view)
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const loading = !hydrated || isQueryLoading(queue) || (!queue.isError && !queue.data)
	const current = VIEWS.find(option => option.value === view) ?? VIEWS[0]

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				title="Approvals"
				description="Approve cleared items for services that need your sign-off, or override a rejection with a reason."
			/>

			<div className="flex flex-wrap gap-2" role="tablist" aria-label="Approval lists">
				{VIEWS.map(option => (
					<button
						key={option.value}
						type="button"
						role="tab"
						aria-selected={view === option.value}
						onClick={() => setView(option.value)}
						className={cn(
							buttonVariants({
								variant: view === option.value ? "default" : "outline",
								size: "sm",
							})
						)}
					>
						{option.label}
					</button>
				))}
			</div>

			{loading ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading…
				</p>
			) : queue.error ? (
				<p className="text-destructive text-sm">{queue.error.message}</p>
			) : !queue.data || queue.data.items.length === 0 ? (
				<p className="text-muted-foreground rounded-xl border p-6 text-sm">{current?.empty}</p>
			) : (
				<div className="rounded-xl border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Appointment</TableHead>
								<TableHead>Client</TableHead>
								<TableHead>Service</TableHead>
								<TableHead>Location</TableHead>
								<TableHead>Reference Number</TableHead>
								<TableHead>Assessed by</TableHead>
								<TableHead className="text-right">Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{queue.data.items.map(item => (
								<TableRow key={item.bookingItemId}>
									<TableCell className="whitespace-nowrap">
										{manilaDateKey(item.startsAt)}
									</TableCell>
									<TableCell className="font-medium">{item.clientName}</TableCell>
									<TableCell>{item.serviceName}</TableCell>
									<TableCell>{item.location.name}</TableCell>
									<TableCell className="font-mono text-xs">{item.referenceNumber}</TableCell>
									<TableCell className="text-sm">
										{item.assessedBy ?? "—"}
										{item.assessedAt ? (
											<span className="text-muted-foreground block text-xs">
												{dateTimeFormatter.format(item.assessedAt)}
											</span>
										) : null}
									</TableCell>
									<TableCell className="text-right">
										<Link
											href={`/processing/${item.bookingItemId}` as Route}
											className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
										>
											{view === "pending" ? "Review" : "Open"}
										</Link>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</section>
	)
}
