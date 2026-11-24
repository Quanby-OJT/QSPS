"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { toast } from "sonner"

import type { Booking } from "@repo/contracts"

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
import {
	useCancelBookingMutation,
	usePayOnsiteMutation,
	useUnpaidBookingQuery,
} from "@/features/bookings/api/bookings.hooks"
import {
	BookingFeeLines,
	feeLinesFromItems,
	slotDetail,
} from "@/features/bookings/components/booking-fee-lines"
import { RescheduleItemDialog } from "@/features/bookings/components/reschedule-item-dialog"
import { PaymentCheckout } from "@/features/payments/components/payment-checkout"
import { dateLabel, manilaDateKey, manilaTime } from "@/features/schedules/lib/calendar"

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback
}

/**
 * The client's booking awaiting payment, on the dashboard (BKG-2, BKG-5).
 */
export function UnpaidBookingCard() {
	const hydrated = useHydrated()
	const isQueryLoading = useIsQueryLoading()
	const unpaid = useUnpaidBookingQuery(true)
	const payOnsite = usePayOnsiteMutation()
	const cancel = useCancelBookingMutation()

	const [onsiteKey, setOnsiteKey] = useState(newIdempotencyKey)
	const [cancelKey, setCancelKey] = useState(newIdempotencyKey)
	const [redirecting, setRedirecting] = useState(false)
	const [choosingChannel, setChoosingChannel] = useState(false)

	if (!hydrated || isQueryLoading(unpaid)) {
		return <Skeleton className="h-40 w-full rounded-xl" />
	}
	if (!unpaid.data) return null
	const booking = unpaid.data

	async function chooseOnsite() {
		try {
			await payOnsite.mutateAsync({ bookingId: booking.id, idempotencyKey: onsiteKey })
			toast.success("You will pay at the BOQ cashier")
		} catch (error) {
			toast.error(errorMessage(error, "Could not change how you pay"))
		} finally {
			setOnsiteKey(newIdempotencyKey())
		}
	}

	async function cancelBooking() {
		try {
			await cancel.mutateAsync({ bookingId: booking.id, idempotencyKey: cancelKey })
			toast.success(`Booking ${booking.referenceNumber} was cancelled`)
		} catch (error) {
			toast.error(errorMessage(error, "Could not cancel the booking"))
		} finally {
			setCancelKey(newIdempotencyKey())
		}
	}

	return (
		<UnpaidBookingDetails
			booking={booking}
			paying={redirecting}
			choosingOnsite={payOnsite.isPending}
			cancelling={cancel.isPending}
			onPayNow={() => setChoosingChannel(true)}
			checkout={
				choosingChannel ? (
					<PaymentCheckout bookingId={booking.id} onRedirect={() => setRedirecting(true)} />
				) : null
			}
			onPayOnsite={() => void chooseOnsite()}
			onCancel={() => void cancelBooking()}
		/>
	)
}

interface UnpaidBookingDetailsProps {
	booking: Booking
	paying: boolean
	choosingOnsite: boolean
	cancelling: boolean
	onPayNow: () => void
	onPayOnsite: () => void
	onCancel: () => void
	checkout?: ReactNode
}

/** What the card shows, without the requests (tested on its own). */
export function UnpaidBookingDetails({
	booking,
	paying,
	choosingOnsite,
	cancelling,
	onPayNow,
	onPayOnsite,
	onCancel,
	checkout,
}: UnpaidBookingDetailsProps) {
	const [confirmingCancel, setConfirmingCancel] = useState(false)
	const [reschedulingItemId, setReschedulingItemId] = useState<number | null>(null)
	const busy = paying || choosingOnsite || cancelling

	const reschedulingItem =
		booking.items.find(item => item.id === reschedulingItemId) ?? null

	return (
		<Card className="border-t-gold border-t-4">
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle>Booking awaiting payment</CardTitle>
					<div className="flex items-center gap-2">
						<Badge variant="secondary">Pending payment</Badge>
						<Button size="sm" variant="ghost" render={<Link href={`/book/${booking.id}`} />}>
							View details
						</Button>
					</div>
				</div>
				<CardDescription>
					You can have one unpaid booking at a time. Pay or cancel it before booking again.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div>
					<p className="text-muted-foreground text-sm">Reference Number</p>
					<p className="font-mono text-xl font-semibold tracking-wide">{booking.referenceNumber}</p>
				</div>
				<BookingFeeLines
					lines={feeLinesFromItems(booking.items)}
					totalCentavos={booking.totalCentavos}
				/>

				<ul className="flex flex-col gap-2" aria-label="Manage booking items">
					{booking.items.map(item => (
						<li
							key={item.id}
							className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
						>
							<div>
								<p className="font-medium">{item.serviceName}</p>
								<p className="text-muted-foreground text-xs">
									{slotDetail(item.locationName, item)} · Rescheduled {item.rescheduleCount}{" "}
									{item.rescheduleCount === 1 ? "time" : "times"}
								</p>
							</div>
							{item.status === "booked" ? (
								<Button
									type="button"
									size="sm"
									variant="outline"
									disabled={busy}
									onClick={() => setReschedulingItemId(item.id)}
								>
									Reschedule
								</Button>
							) : null}
						</li>
					))}
				</ul>

				<RescheduleItemDialog
					bookingId={booking.id}
					item={reschedulingItem}
					open={reschedulingItem !== null}
					onOpenChange={open => {
						if (!open) setReschedulingItemId(null)
					}}
				/>

				{booking.payOnsite ? (
					<p className="text-sm">
						You chose to pay at the BOQ cashier. Arrive early: an unpaid booking is cancelled
						shortly before its slot starts.
					</p>
				) : booking.holdExpiresAt ? (
					<p className="text-sm">
						Pay by{" "}
						<span className="font-medium">
							{manilaTime(booking.holdExpiresAt)} on{" "}
							{dateLabel(manilaDateKey(booking.holdExpiresAt))}
						</span>{" "}
						or the booking is cancelled and the slot is released.
					</p>
				) : null}

				{checkout}

				{confirmingCancel ? (
					<div className="flex flex-wrap items-center gap-2">
						<p className="text-sm font-medium">Cancel this booking and give up the slot?</p>
						<Button type="button" variant="destructive" onClick={onCancel} disabled={busy}>
							{cancelling ? "Cancelling…" : "Yes, cancel it"}
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => setConfirmingCancel(false)}
							disabled={cancelling}
						>
							Keep it
						</Button>
					</div>
				) : (
					<div className="flex flex-wrap gap-2">
						{checkout ? null : (
							<Button type="button" onClick={onPayNow} disabled={busy}>
								{paying ? "Opening checkout…" : "Pay now"}
							</Button>
						)}
						{booking.payOnsite ? null : (
							<Button type="button" variant="outline" onClick={onPayOnsite} disabled={busy}>
								{choosingOnsite ? "Saving…" : "Pay at the office"}
							</Button>
						)}
						<Button
							type="button"
							variant="ghost"
							onClick={() => setConfirmingCancel(true)}
							disabled={busy}
						>
							Cancel booking
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	)
}