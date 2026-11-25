"use client"

import { useState } from "react"
import Link from "next/link"
import {
	Add01Icon,
	ArrowRight01Icon,
	CheckmarkCircle02Icon,
	Copy01Icon,
	File01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { BookingSummary, ClientBookingStatus } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
} from "@/core/components/ui/card"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { useMyBookingsQuery } from "@/features/bookings/api/bookings.hooks"
import {
	BookingFeeLines,
	feeLinesFromItems,
} from "@/features/bookings/components/booking-fee-lines"
import {
	clientStatusBadgeVariant,
	manilaDateTimeLabel,
} from "@/features/bookings/lib/booking-display"
import { dateLabel, manilaDateKey } from "@/features/schedules/lib/calendar"
import { feeInPesos } from "@/features/services/lib/fee"

type StatusFilter = "All" | ClientBookingStatus

const FILTERS: readonly StatusFilter[] = ["All", "Pending", "Paid", "Cancelled"]

function ReferenceCopyButton({ referenceNumber }: { referenceNumber: string }) {
	const [copied, setCopied] = useState(false)

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(referenceNumber)
			setCopied(true)
			setTimeout(() => setCopied(false), 1800)
		} catch {
			// Ignore when clipboard access is unavailable.
		}
	}

	return (
		<button
			type="button"
			onClick={() => void handleCopy()}
			className="hover:text-primary inline-flex items-center gap-1.5 font-mono text-base font-semibold tracking-wide"
			aria-label={`Copy reference number ${referenceNumber}`}
		>
			<span>{referenceNumber}</span>
			{copied ? (
				<HugeiconsIcon
					icon={CheckmarkCircle02Icon}
					strokeWidth={2}
					className="size-3.5 text-emerald-600"
					aria-hidden="true"
				/>
			) : (
				<HugeiconsIcon
					icon={Copy01Icon}
					strokeWidth={2}
					className="text-muted-foreground size-3.5"
					aria-hidden="true"
				/>
			)}
		</button>
	)
}

export function TransactionCard({
	booking,
	detailHref,
}: {
	booking: BookingSummary
	detailHref: string
}) {
	return (
		<Card data-testid={`booking-card-${booking.id}`}>
			<CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<ReferenceCopyButton referenceNumber={booking.referenceNumber} />
						<Badge variant={clientStatusBadgeVariant(booking.clientStatus)}>
							{booking.clientStatus}
						</Badge>
						{booking.status === "refund_requested" ? (
							<Badge variant="outline">Refund in progress</Badge>
						) : null}
						{booking.status === "pending_payment" && booking.payOnsite ? (
							<Badge variant="outline">Pay at BOQ cashier</Badge>
						) : null}
					</div>
					<CardDescription>Booked on {dateLabel(manilaDateKey(booking.createdAt))}</CardDescription>
				</div>

				<div className="text-left sm:text-right">
					<p className="text-muted-foreground text-xs">Total</p>
					<p className="text-lg font-semibold tabular-nums">₱{feeInPesos(booking.totalCentavos)}</p>
				</div>
			</CardHeader>

			<CardContent className="space-y-3">
				<BookingFeeLines
					lines={feeLinesFromItems(booking.items)}
					totalCentavos={booking.totalCentavos}
				/>
				{booking.status === "pending_payment" && !booking.payOnsite && booking.holdExpiresAt ? (
					<p className="text-muted-foreground text-xs">
						Hold expires on {manilaDateTimeLabel(booking.holdExpiresAt)}
					</p>
				) : null}
			</CardContent>

			<CardFooter className="border-border flex flex-wrap items-center justify-between gap-2 border-t pt-4">
				<span className="text-muted-foreground text-xs">
					{booking.items.length} {booking.items.length === 1 ? "service" : "services"}
				</span>
				<Link href={detailHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
					View details
					<HugeiconsIcon
						icon={ArrowRight01Icon}
						strokeWidth={2}
						className="ml-1.5 size-4"
						aria-hidden="true"
					/>
				</Link>
			</CardFooter>
		</Card>
	)
}

interface MyTransactionsListProps {
	bookings: readonly BookingSummary[]
	bookingBasePath?: string
	newBookingHref?: string
}

/** Pure list view with status filter tabs (tested directly in Vitest). */
export function MyTransactionsList({
	bookings,
	bookingBasePath = "/transactions",
	newBookingHref = "/book",
}: MyTransactionsListProps) {
	const [filter, setFilter] = useState<StatusFilter>("All")

	if (bookings.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12 text-center">
					<HugeiconsIcon
						icon={File01Icon}
						strokeWidth={2}
						className="text-muted-foreground mb-3 size-10"
						aria-hidden="true"
					/>
					<p className="text-lg font-semibold">No transactions yet</p>
					<p className="text-muted-foreground mt-1 max-w-md text-sm">
						You haven’t booked any quarantine services yet. Start a booking to schedule your
						vaccination, seminar, or health certificate appointment.
					</p>
					<Link href={newBookingHref} className={`${buttonVariants({})} mt-5`}>
						<HugeiconsIcon
							icon={Add01Icon}
							strokeWidth={2}
							className="mr-1.5 size-4"
							aria-hidden="true"
						/>
						Book a service
					</Link>
				</CardContent>
			</Card>
		)
	}

	const filtered =
		filter === "All" ? bookings : bookings.filter(booking => booking.clientStatus === filter)

	return (
		<div className="flex flex-col gap-4">
			<div
				className="flex flex-wrap gap-2"
				role="tablist"
				aria-label="Filter transactions by status"
			>
				{FILTERS.map(tab => {
					const count =
						tab === "All" ? bookings.length : bookings.filter(b => b.clientStatus === tab).length
					const active = filter === tab
					return (
						<Button
							key={tab}
							type="button"
							role="tab"
							aria-selected={active}
							variant={active ? "default" : "outline"}
							size="sm"
							onClick={() => setFilter(tab)}
						>
							{tab} ({count})
						</Button>
					)
				})}
			</div>

			{filtered.length === 0 ? (
				<Card>
					<CardContent className="text-muted-foreground py-10 text-center text-sm">
						No {filter.toLowerCase()} transactions found.
					</CardContent>
				</Card>
			) : (
				<div className="flex flex-col gap-4">
					{filtered.map(booking => (
						<TransactionCard
							key={booking.id}
							booking={booking}
							detailHref={`${bookingBasePath}/${booking.id}`}
						/>
					))}
				</div>
			)}
		</div>
	)
}

export function MyTransactionsView({
	bookingBasePath = "/transactions",
	newBookingHref = "/book",
}: {
	bookingBasePath?: string
	newBookingHref?: string
}) {
	const hydrated = useHydrated()
	const isQueryLoading = useIsQueryLoading()
	const transactions = useMyBookingsQuery(hydrated)

	const loading = !hydrated || isQueryLoading(transactions)

	return (
		<section className="flex w-full max-w-4xl flex-col gap-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<PageHeader
					title="My Transactions"
					description="View your Bureau of Quarantine bookings, payment status, e-Receipts, and issued documents."
				/>
				<Link href={newBookingHref} className={`${buttonVariants({})} self-start sm:self-auto`}>
					<HugeiconsIcon
						icon={Add01Icon}
						strokeWidth={2}
						className="mr-1.5 size-4"
						aria-hidden="true"
					/>
					Book a service
				</Link>
			</div>

			{loading ? (
				<div className="flex flex-col gap-4" role="status" aria-label="Loading transactions">
					<Skeleton className="h-44 w-full rounded-xl" />
					<Skeleton className="h-44 w-full rounded-xl" />
				</div>
			) : transactions.isError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load your transactions.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						{transactions.error instanceof Error ? transactions.error.message : "Please try again."}
					</p>
					<Button
						className="mt-3"
						variant="outline"
						size="sm"
						onClick={() => void transactions.refetch()}
					>
						Retry
					</Button>
				</div>
			) : (
				<MyTransactionsList
					bookings={transactions.data?.bookings ?? []}
					bookingBasePath={bookingBasePath}
					newBookingHref={newBookingHref}
				/>
			)}
		</section>
	)
}
