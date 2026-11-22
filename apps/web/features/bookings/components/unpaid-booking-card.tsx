"use client"

import { useState } from "react"
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
	DEFAULT_PAYMENT_CHANNEL,
	useCreatePaymentMutation,
} from "@/features/payments/api/payments.hooks"
import {
	dateLabel,
	manilaDateKey,
	manilaTime,
	slotTimeRange,
} from "@/features/schedules/lib/calendar"
import { feeInPesos } from "@/features/services/lib/fee"

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback
}

/**
 * The client's booking awaiting payment, on the dashboard (BKG-2). A client
 * has at most one; booking again is refused until it is paid or cancelled,
 * so this is where they pay it, switch to paying at the office, or cancel it.
 */
export function UnpaidBookingCard() {
	const hydrated = useHydrated()
	const isQueryLoading = useIsQueryLoading()
	const unpaid = useUnpaidBookingQuery(true)
	const createPayment = useCreatePaymentMutation()
	const payOnsite = usePayOnsiteMutation()
	const cancel = useCancelBookingMutation()

	// One key per attempt each, so a double click sends one request.
	const [paymentKey, setPaymentKey] = useState(newIdempotencyKey)
	const [onsiteKey, setOnsiteKey] = useState(newIdempotencyKey)
	const [cancelKey, setCancelKey] = useState(newIdempotencyKey)
	const [redirecting, setRedirecting] = useState(false)

	if (!hydrated || isQueryLoading(unpaid)) {
		return <Skeleton className="h-40 w-full rounded-xl" />
	}
	if (!unpaid.data) return null
	const booking = unpaid.data

	async function payNow() {
		try {
			const checkout = await createPayment.mutateAsync({
				bookingId: booking.id,
				channelCode: DEFAULT_PAYMENT_CHANNEL,
				idempotencyKey: paymentKey,
			})
			setRedirecting(true)
			window.location.assign(checkout.checkoutUrl)
		} catch (error) {
			toast.error(errorMessage(error, "Could not start the payment"))
			setPaymentKey(newIdempotencyKey())
		}
	}

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
			paying={createPayment.isPending || redirecting}
			choosingOnsite={payOnsite.isPending}
			cancelling={cancel.isPending}
			onPayNow={() => void payNow()}
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
}: UnpaidBookingDetailsProps) {
	const [confirmingCancel, setConfirmingCancel] = useState(false)
	const busy = paying || choosingOnsite || cancelling

	return (
		<Card className="border-t-gold border-t-4">
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle>Booking awaiting payment</CardTitle>
					<Badge variant="secondary">Pending payment</Badge>
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
				<dl className="grid gap-2 text-sm">
					{booking.items.map(item => (
						<div key={item.id}>
							<dt className="font-medium">{item.serviceName}</dt>
							<dd className="text-muted-foreground">
								{item.locationName} · {dateLabel(manilaDateKey(item.startsAt))} ·{" "}
								{slotTimeRange(item)}
							</dd>
						</div>
					))}
					<div>
						<dt className="text-muted-foreground">Total</dt>
						<dd>₱{feeInPesos(booking.totalCentavos)}</dd>
					</div>
				</dl>

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
						<Button type="button" onClick={onPayNow} disabled={busy}>
							{paying ? "Opening checkout…" : "Pay now"}
						</Button>
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
