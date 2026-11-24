"use client"

import { useState } from "react"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"

import type { Booking } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { useBookingQuery } from "@/features/bookings/api/bookings.hooks"
import {
	BookingFeeLines,
	feeLinesFromItems,
	slotDetail,
} from "@/features/bookings/components/booking-fee-lines"
import { RescheduleItemDialog } from "@/features/bookings/components/reschedule-item-dialog"
import { dateLabel, manilaDateKey, manilaTime } from "@/features/schedules/lib/calendar"

function statusBadge(status: Booking["status"]) {
	switch (status) {
		case "paid":
			return <Badge>Paid</Badge>
		case "pending_payment":
			return <Badge variant="secondary">Pending payment</Badge>
		case "cancelled":
			return <Badge variant="destructive">Cancelled</Badge>
		case "expired":
			return <Badge variant="outline">Expired</Badge>
		default:
			return <Badge variant="outline">{status}</Badge>
	}
}

/**
 * BKG-5: Booking detail view for both `pending_payment` and `paid` bookings.
 * Shows each Booking Item's reschedule counter and lets the client open the
 * Reschedule dialog on eligible `booked` items.
 */
export function BookingDetail({ bookingId }: { bookingId: number }) {
	const hydrated = useHydrated()
	const isQueryLoading = useIsQueryLoading()
	const bookingQuery = useBookingQuery(bookingId)
	const [reschedulingItemId, setReschedulingItemId] = useState<number | null>(null)

	if (!hydrated || isQueryLoading(bookingQuery)) {
		return <Skeleton className="h-64 w-full max-w-3xl rounded-xl" />
	}

	if (bookingQuery.isError || !bookingQuery.data) {
		return (
			<section className="flex w-full max-w-3xl flex-col gap-4">
				<PageHeader title="Booking details" description="Unable to load this booking." />
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Booking could not be loaded.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						{bookingQuery.error instanceof Error
							? bookingQuery.error.message
							: "Check that you are signed in to the account that created this booking."}
					</p>
					<div className="mt-3 flex gap-2">
						<Button type="button" variant="outline" onClick={() => void bookingQuery.refetch()}>
							Retry
						</Button>
						<Button asChild variant="ghost">
							<Link href="/dashboard">Back to dashboard</Link>
						</Button>
					</div>
				</div>
			</section>
		)
	}

	const booking = bookingQuery.data
	const canRescheduleBooking =
		booking.status === "pending_payment" || booking.status === "paid"
	const reschedulingItem =
		booking.items.find(item => item.id === reschedulingItemId) ?? null

	return (
		<section className="flex w-full max-w-3xl flex-col gap-6">
			<PageHeader
				title={`Booking ${booking.referenceNumber}`}
				description="View your reserved services, reschedule counter, and schedule details."
			/>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div>
							<CardTitle className="font-mono text-xl tracking-wide">
								{booking.referenceNumber}
							</CardTitle>
							<CardDescription>
								Created on {dateLabel(manilaDateKey(booking.createdAt))}
							</CardDescription>
						</div>
						{statusBadge(booking.status)}
					</div>
				</CardHeader>
				<CardContent className="flex flex-col gap-6">
					<div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
						<div className="rounded-lg bg-white p-3">
							<QRCodeSVG
								value={booking.referenceNumber}
								size={132}
								title={`QR code for reference number ${booking.referenceNumber}`}
							/>
						</div>
						<div className="w-full flex-1">
							<BookingFeeLines
								lines={feeLinesFromItems(booking.items)}
								totalCentavos={booking.totalCentavos}
							/>
						</div>
					</div>

					{booking.status === "pending_payment" && booking.holdExpiresAt ? (
						<p className="text-sm">
							Pay by{" "}
							<span className="font-medium">
								{manilaTime(booking.holdExpiresAt)} on{" "}
								{dateLabel(manilaDateKey(booking.holdExpiresAt))}
							</span>{" "}
							to keep your slots.
						</p>
					) : null}

					<div className="flex flex-col gap-3">
						<h3 className="text-sm font-semibold">Services & rescheduling</h3>
						<ul className="flex flex-col gap-3" aria-label="Booking items">
							{booking.items.map(item => (
								<li
									key={item.id}
									className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
								>
									<div className="flex flex-col gap-1">
										<p className="font-medium">{item.serviceName}</p>
										<p className="text-muted-foreground text-sm">
											{slotDetail(item.locationName, item)}
										</p>
										<p className="text-muted-foreground text-xs">
											Rescheduled:{" "}
											<span className="text-foreground font-medium">
												{item.rescheduleCount} {item.rescheduleCount === 1 ? "time" : "times"}
											</span>{" "}
											· Status: <span className="capitalize">{item.status}</span>
										</p>
									</div>
									{canRescheduleBooking && item.status === "booked" ? (
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() => setReschedulingItemId(item.id)}
										>
											Reschedule
										</Button>
									) : null}
								</li>
							))}
						</ul>
					</div>
				</CardContent>
			</Card>

			<RescheduleItemDialog
				bookingId={booking.id}
				item={reschedulingItem}
				open={reschedulingItem !== null}
				onOpenChange={open => {
					if (!open) setReschedulingItemId(null)
				}}
			/>

			<div>
				<Button asChild variant="outline">
					<Link href="/dashboard">Back to dashboard</Link>
				</Button>
			</div>
		</section>
	)
}