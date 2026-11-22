"use client"

import {
	Call02Icon,
	Clock01Icon,
	CustomerSupportIcon,
	Globe02Icon,
	LinkSquare02Icon,
	Mail01Icon,
	Ticket01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

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
import { useSupportContactsQuery } from "@/features/support/api/support.hooks"
import {
	contactChannels,
	type ContactChannel,
	type ContactChannelKind,
} from "@/features/support/lib/contact-channels"
import { env } from "@/env"

const CHANNEL_ICONS: Record<ContactChannelKind, IconSvgElement> = {
	phone: Call02Icon,
	email: Mail01Icon,
	ticket: Ticket01Icon,
	hours: Clock01Icon,
}

/**
 * ADM-8: the Help page (TOR §IX). Shows the help desk channels BOQ publishes
 * on the policy screen; a channel with no value is left out. Open to anyone,
 * signed in or not, and linked from the footer of every page.
 */
export function HelpView() {
	const query = useSupportContactsQuery()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const loading = !hydrated || isQueryLoading(query)
	const channels = query.data ? contactChannels(query.data) : []

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={CustomerSupportIcon}
				title="Help"
				description="How to reach the Bureau of Quarantine help desk about bookings, payments and documents."
			/>

			<section className="bg-card rounded-xl border p-4" aria-labelledby="help-desk-heading">
				<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
				<h2 id="help-desk-heading" className="text-lg font-bold tracking-tight">
					Help desk
				</h2>

				{loading ? (
					<div
						className="mt-3 flex flex-col gap-2"
						role="status"
						aria-label="Loading help desk contacts"
					>
						<Skeleton className="h-14 w-full rounded-lg" />
						<Skeleton className="h-14 w-full rounded-lg" />
					</div>
				) : query.isError ? (
					<div className="border-destructive/30 bg-destructive/5 mt-3 rounded-lg border p-4">
						<p className="text-sm font-medium">Could not load the help desk contacts.</p>
						<Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
							Retry
						</Button>
					</div>
				) : channels.length === 0 ? (
					<Empty className="mt-3 border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<HugeiconsIcon icon={CustomerSupportIcon} strokeWidth={2} />
							</EmptyMedia>
							<EmptyTitle>No help desk contacts yet</EmptyTitle>
							<EmptyDescription>
								The help desk has not published its contacts. Please check the official Bureau of
								Quarantine website below.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="mt-2 flex flex-col">
						{channels.map(channel => (
							<ChannelRow key={channel.kind} channel={channel} />
						))}
					</ul>
				)}
			</section>

			<section className="bg-card rounded-xl border p-4" aria-labelledby="boq-website-heading">
				<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
				<h2 id="boq-website-heading" className="text-lg font-bold tracking-tight">
					Bureau of Quarantine
				</h2>
				<p className="text-muted-foreground mt-1 text-sm">
					News, advisories and the full list of services are on the official website.
				</p>
				<a
					href={env.NEXT_PUBLIC_BOQ_WEBSITE_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary mt-3 inline-flex items-center gap-2 break-all text-sm font-semibold underline-offset-4 hover:underline"
				>
					<HugeiconsIcon icon={Globe02Icon} strokeWidth={2} className="size-4 shrink-0" />
					Official BOQ website
					<span className="sr-only">(opens in a new tab)</span>
				</a>
			</section>
		</section>
	)
}

function ChannelRow({ channel }: { channel: ContactChannel }) {
	return (
		<li className="flex items-start gap-3 border-t py-3 first:border-t-0">
			<div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
				<HugeiconsIcon icon={CHANNEL_ICONS[channel.kind]} strokeWidth={2} className="size-4" />
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-muted-foreground text-xs font-medium">{channel.label}</p>
				{channel.href ? (
					<a
						href={channel.href}
						{...(channel.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
						className="text-primary inline-flex items-center gap-1 break-all text-sm font-semibold underline-offset-4 hover:underline"
					>
						{channel.value}
						{channel.external ? (
							<>
								<HugeiconsIcon
									icon={LinkSquare02Icon}
									strokeWidth={2}
									className="size-3.5 shrink-0"
								/>
								<span className="sr-only">(opens in a new tab)</span>
							</>
						) : null}
					</a>
				) : (
					<p className="text-sm font-semibold">{channel.value}</p>
				)}
			</div>
		</li>
	)
}
