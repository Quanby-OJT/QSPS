"use client"

import { useState } from "react"
import Link from "next/link"
import {
	ArrowLeft01Icon,
	CheckmarkCircle02Icon,
	File01Icon,
	LinkSquare01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"

import type { BookingDetail } from "@repo/contracts"

import { PeResultsDownload } from "@/features/bookings/components/pe-results-download"

import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	useBookingDetailQuery,
	useCancelBookingMutation,
	usePayOnsiteMutation,
} from "@/features/bookings/api/bookings.hooks"
import { slotDetail } from "@/features/bookings/components/booking-fee-lines"
import { RescheduleItemDialog } from "@/features/bookings/components/reschedule-item-dialog"
import {
	cancelReasonLabel,
	clientStatusBadgeVariant,
	documentStatusLabel,
	documentTypeLabel,
	itemStatusBadgeVariant,
	itemStatusLabel,
	manilaDateTimeLabel,
	paymentStatusLabel,
} from "@/features/bookings/lib/booking-display"
import { PaymentCheckout } from "@/features/payments/components/payment-checkout"
import { dateLabel, manilaDateKey } from "@/features/schedules/lib/calendar"
import { feeInPesos } from "@/features/services/lib/fee"

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

interface BookingDetailContentProps {
	booking: BookingDetail
	backHref?: string
	paying?: boolean
	choosingOnsite?: boolean
	cancelling?: boolean
	choosingChannel?: boolean
	onPayNow?: () => void
	onRedirect?: () => void
	onPayOnsite?: () => void
	onCancel?: () => void
	/** BKG-5: open the reschedule dialog for one item. */
	onReschedule?: (bookingItemId: number) => void
}

/** Pure detail view (tested directly in Vitest). */
export function BookingDetailContent({
	booking,
	backHref = "/transactions",
	paying = false,
	choosingOnsite = false,
	cancelling = false,
	choosingChannel = false,
	onPayNow,
	onRedirect,
	onPayOnsite,
	onCancel,
	onReschedule,
}: BookingDetailContentProps) {
	const [confirmingCancel, setConfirmingCancel] = useState(false)
	const busy = paying || choosingOnsite || cancelling

	return (
		<div className="flex flex-col gap-6">
			<div>
				<Link
					href={backHref}
					className={`${buttonVariants({ variant: "ghost", size: "sm" })} -ml-2`}
				>
					<HugeiconsIcon
						icon={ArrowLeft01Icon}
						strokeWidth={2}
						className="mr-1.5 size-4"
						aria-hidden="true"
					/>
					Back to My Transactions
				</Link>
			</div>

			{/* Summary Header */}
			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-1.5">
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="font-mono text-2xl font-bold tracking-tight">
								{booking.referenceNumber}
							</h1>
							<Badge variant={clientStatusBadgeVariant(booking.clientStatus)}>
								{booking.clientStatus}
							</Badge>
							{booking.status === "refund_requested" ? (
								<Badge variant="outline">Refund in progress</Badge>
							) : null}
							{booking.status === "refund_requested" ? (
								<Badge variant="outline">Refund in progress</Badge>
							) : null}
							{booking.status === "pending_payment" && booking.payOnsite ? (
								<Badge variant="outline">Pay at BOQ cashier</Badge>
							) : null}
						</div>
						<CardDescription>Booked on {manilaDateTimeLabel(booking.createdAt)}</CardDescription>
					</div>

					<div className="text-left sm:text-right">
						<p className="text-muted-foreground text-xs">Total service fees</p>
						<p className="text-2xl font-bold tabular-nums">₱{feeInPesos(booking.totalCentavos)}</p>
					</div>
				</CardHeader>

				{booking.clientStatus !== "Cancelled" ? (
					<CardContent className="border-border flex flex-col items-center gap-4 border-t pt-4 sm:flex-row">
						<div className="rounded-lg bg-white p-3">
							<QRCodeSVG
								value={booking.referenceNumber}
								size={128}
								title={`QR code for reference number ${booking.referenceNumber}`}
							/>
						</div>
						<p className="text-muted-foreground text-sm">
							Show this QR code, or your Reference Number, when you pay at the BOQ cashier and when
							you arrive.
						</p>
					</CardContent>
				) : null}

				{booking.status === "pending_payment" ? (
					<CardContent className="border-border flex flex-col gap-4 border-t pt-4">
						{confirmingCancel ? (
							<div className="flex flex-wrap items-center gap-2">
								<p className="text-sm font-medium">Cancel this booking and give up the slot?</p>
								<Button
									type="button"
									variant="destructive"
									size="sm"
									disabled={busy}
									onClick={() => onCancel?.()}
								>
									{cancelling ? "Cancelling…" : "Yes, cancel it"}
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={cancelling}
									onClick={() => setConfirmingCancel(false)}
								>
									Keep it
								</Button>
							</div>
						) : (
							<div className="flex flex-wrap gap-2">
								{choosingChannel ? (
									<div className="basis-full">
										<PaymentCheckout bookingId={booking.id} onRedirect={onRedirect} />
									</div>
								) : (
									<Button type="button" size="sm" disabled={busy} onClick={() => onPayNow?.()}>
										{paying ? "Opening checkout…" : "Pay now"}
									</Button>
								)}
								{booking.payOnsite ? null : (
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={busy}
										onClick={() => onPayOnsite?.()}
									>
										{choosingOnsite ? "Saving…" : "Pay at the office"}
									</Button>
								)}
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={busy}
									onClick={() => setConfirmingCancel(true)}
								>
									Cancel booking
								</Button>
							</div>
						)}
					</CardContent>
				) : null}

				{booking.clientStatus === "Cancelled" ? (
					<CardContent className="border-border border-t pt-4">
						<p className="text-muted-foreground text-sm">
							{cancelReasonLabel(booking.cancelReason) ?? "This booking is no longer active."}
							{booking.cancelledAt ? ` · ${manilaDateTimeLabel(booking.cancelledAt)}` : ""}
						</p>
					</CardContent>
				) : null}
			</Card>

			{/* Booked Services & Processing Status */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<HugeiconsIcon
							icon={CheckmarkCircle02Icon}
							strokeWidth={2}
							className="text-primary size-5"
							aria-hidden="true"
						/>
						Booked Services & Processing Status
					</CardTitle>
					<CardDescription>
						Each service progresses independently through check-in, assessment, and document
						issuance.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					{booking.items.map(item => (
						<div
							key={item.id}
							data-testid={`booking-item-${item.id}`}
							className="border-border flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-semibold">{item.serviceName}</span>
									<Badge
										variant={
											booking.status === "cancelled"
												? "destructive"
												: itemStatusBadgeVariant(item.status)
										}
									>
										{booking.status === "cancelled" ? "Cancelled" : itemStatusLabel(item.status)}
									</Badge>
									{onReschedule &&
									item.status === "booked" &&
									(booking.rescheduleLimit === undefined ||
										item.rescheduleCount < booking.rescheduleLimit) &&
									(booking.status === "pending_payment" || booking.status === "paid") ? (
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() => onReschedule(item.id)}
										>
											Reschedule
										</Button>
									) : null}
								</div>
								<p className="text-muted-foreground text-xs">
									{slotDetail(item.locationName, item)}
								</p>
								{item.serviceName === "Physical Examination" ? <PeResultsDownload itemId={item.id} /> : null}
							</div>
							<p className="text-sm font-semibold tabular-nums">₱{feeInPesos(item.feeCentavos)}</p>
						</div>
					))}
				</CardContent>
			</Card>

			{/* Payment & e-Receipt */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<HugeiconsIcon
							icon={File01Icon}
							strokeWidth={2}
							className="text-primary size-5"
							aria-hidden="true"
						/>
						Payment & e-Receipt
					</CardTitle>
					<CardDescription>
						Official payment record and electronic receipt for this booking.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{!booking.payment ? (
						<p className="text-muted-foreground text-sm">No payment has been recorded yet.</p>
					) : (
						<div className="space-y-4">
							<dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
								<div>
									<dt className="text-muted-foreground">Payment status</dt>
									<dd className="mt-0.5 font-medium">
										{paymentStatusLabel(booking.payment.status)}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Payment channel</dt>
									<dd className="mt-0.5 font-medium">{booking.payment.channelName}</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Service fees</dt>
									<dd className="mt-0.5 font-medium tabular-nums">
										₱{feeInPesos(booking.totalCentavos)}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Convenience fee</dt>
									<dd className="mt-0.5 font-medium tabular-nums">
										₱{feeInPesos(booking.payment.convenienceFeeCentavos)}
									</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Total amount paid</dt>
									<dd className="mt-0.5 font-semibold tabular-nums">
										₱{feeInPesos(booking.payment.amountCentavos)}
									</dd>
								</div>
								{booking.payment.paidAt ? (
									<div>
										<dt className="text-muted-foreground">Paid at</dt>
										<dd className="mt-0.5 font-medium">
											{manilaDateTimeLabel(booking.payment.paidAt)}
										</dd>
									</div>
								) : null}
							</dl>

							{booking.receipt ? (
								<div className="border-border bg-muted/40 flex flex-col gap-3 rounded-lg border-t p-4 sm:flex-row sm:items-center sm:justify-between">
									<div className="space-y-1">
										<p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
											Official e-Receipt
										</p>
										<p className="font-mono text-base font-semibold">
											{booking.receipt.receiptNumber}
										</p>
										<p className="text-muted-foreground text-xs">
											Issued on {manilaDateTimeLabel(booking.receipt.issuedAt)}
										</p>
									</div>
									<Link
										href={`/receipts/${booking.receipt.verificationToken}`}
										className={buttonVariants({ variant: "outline", size: "sm" })}
									>
										View e-Receipt
										<HugeiconsIcon
											icon={LinkSquare01Icon}
											strokeWidth={2}
											className="ml-1.5 size-3.5"
											aria-hidden="true"
										/>
									</Link>
								</div>
							) : null}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Issued Documents */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-lg">
						<HugeiconsIcon
							icon={File01Icon}
							strokeWidth={2}
							className="text-primary size-5"
							aria-hidden="true"
						/>
						Issued Documents
					</CardTitle>
					<CardDescription>
						Certificates and official quarantine records issued upon service completion.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{booking.documents.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No documents have been issued for this booking yet.
						</p>
					) : (
						<ul className="space-y-3">
							{booking.documents.map(doc => (
								<li
									key={doc.id}
									data-testid={`issued-document-${doc.id}`}
									className="border-border flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-semibold">{documentTypeLabel(doc.documentType)}</span>
											<Badge variant={doc.status === "valid" ? "default" : "destructive"}>
												{documentStatusLabel(doc.status)}
											</Badge>
										</div>
										<p className="font-mono text-sm">{doc.documentNumber}</p>
										<p className="text-muted-foreground text-xs">
											{doc.serviceName} · Issued {dateLabel(manilaDateKey(doc.issuedAt))}
											{doc.validUntil ? ` · Valid until ${doc.validUntil}` : ""}
										</p>
									</div>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export function BookingDetailView({
	bookingId,
	backHref = "/transactions",
}: {
	bookingId: number
	backHref?: string
}) {
	const hydrated = useHydrated()
	const isQueryLoading = useIsQueryLoading()
	const detail = useBookingDetailQuery(hydrated ? bookingId : null)
	const payOnsite = usePayOnsiteMutation()
	const cancel = useCancelBookingMutation()

	const [onsiteKey, setOnsiteKey] = useState(newIdempotencyKey)
	const [cancelKey, setCancelKey] = useState(newIdempotencyKey)
	const [redirecting, setRedirecting] = useState(false)
	const [choosingChannel, setChoosingChannel] = useState(false)
	const [reschedulingItemId, setReschedulingItemId] = useState<number | null>(null)

	const loading = !hydrated || isQueryLoading(detail)
	const isNotFound =
		detail.isError && detail.error instanceof ApiError && detail.error.status === 404

	async function handlePayOnsite() {
		try {
			await payOnsite.mutateAsync({ bookingId, idempotencyKey: onsiteKey })
			toast.success("You will pay at the BOQ cashier")
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not change how you pay")
		} finally {
			setOnsiteKey(newIdempotencyKey())
		}
	}

	async function handleCancel() {
		try {
			await cancel.mutateAsync({ bookingId, idempotencyKey: cancelKey })
			toast.success("Booking was cancelled")
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not cancel the booking")
		} finally {
			setCancelKey(newIdempotencyKey())
		}
	}

	return (
		<section className="flex w-full max-w-4xl flex-col gap-6">
			{loading ? (
				<div className="flex flex-col gap-4" role="status" aria-label="Loading booking details">
					<Skeleton className="h-32 w-full rounded-xl" />
					<Skeleton className="h-48 w-full rounded-xl" />
					<Skeleton className="h-40 w-full rounded-xl" />
				</div>
			) : isNotFound ? (
				<Card data-testid="booking-not-found">
					<CardHeader>
						<CardTitle>Booking not found</CardTitle>
						<CardDescription>
							This booking does not exist or you do not have permission to view it.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Link href={backHref} className={buttonVariants({})}>
							Return to My Transactions
						</Link>
					</CardContent>
				</Card>
			) : detail.isError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load booking details.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						{detail.error instanceof Error ? detail.error.message : "Please try again."}
					</p>
					<Button
						className="mt-3"
						variant="outline"
						size="sm"
						onClick={() => void detail.refetch()}
					>
						Retry
					</Button>
				</div>
			) : detail.data ? (
				<>
					<BookingDetailContent
						booking={detail.data}
						backHref={backHref}
						paying={redirecting}
						choosingOnsite={payOnsite.isPending}
						cancelling={cancel.isPending}
						choosingChannel={choosingChannel}
						onPayNow={() => setChoosingChannel(true)}
						onReschedule={setReschedulingItemId}
						onRedirect={() => setRedirecting(true)}
						onPayOnsite={() => void handlePayOnsite()}
						onCancel={() => void handleCancel()}
					/>
					<RescheduleItemDialog
						bookingId={detail.data.id}
						rescheduleLimit={detail.data.rescheduleLimit}
						item={detail.data.items.find(item => item.id === reschedulingItemId) ?? null}
						open={reschedulingItemId !== null}
						onOpenChange={open => {
							if (!open) setReschedulingItemId(null)
						}}
					/>
				</>
			) : null}
		</section>
	)
}
