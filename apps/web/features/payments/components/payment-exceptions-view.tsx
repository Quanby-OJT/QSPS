"use client"

import { useState, type FormEvent } from "react"
import { Alert02Icon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"

import type { PaymentException, PaymentReviewResolution } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Textarea } from "@/core/components/ui/textarea"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import {
	usePaymentExceptionsQuery,
	useResolvePaymentExceptionMutation,
} from "@/features/payments/api/payment-exceptions.hooks"
import { bookingStatusLabel } from "@/features/payments/lib/cashier"
import { feeInPesos } from "@/features/services/lib/fee"

function pesos(centavos: number): string {
	return `₱${Number(feeInPesos(centavos)).toLocaleString("en-PH", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`
}

const DATE_TIME = new Intl.DateTimeFormat("en-PH", {
	timeZone: "Asia/Manila",
	dateStyle: "medium",
	timeStyle: "short",
})

const REASON_LABELS: Record<PaymentException["reason"], { label: string; detail: string }> = {
	late_payment: {
		label: "Late payment",
		detail:
			"Paid after the booking was closed. The booking stays closed; the client has a receipt.",
	},
	duplicate: {
		label: "Duplicate payment",
		detail: "A second payment for a booking that was already paid. No second receipt was issued.",
	},
}

/**
 * Payment exceptions (PAY-6): money that arrived but could not be applied.
 * The client was told BOQ will contact them; staff resolve each one by
 * rebooking the client or opening a Refund Request.
 */
export function PaymentExceptionsView() {
	const hydrated = useHydrated()
	const query = usePaymentExceptionsQuery()
	const forbidden = query.error instanceof ApiError && query.error.status === 403

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={Alert02Icon}
				title="Payment exceptions"
				description="Payments that arrived for a closed booking, or a second time for a paid one. Resolve each by rebooking the client or opening a refund request. Every resolution is recorded in the audit log."
			/>

			{forbidden ? (
				<p role="alert" className="text-sm">
					You do not have access to payment exceptions. Viewing them needs the
					payments.transactions:read permission. This attempt has been recorded.
				</p>
			) : !hydrated || query.isPending ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading payment exceptions…
				</p>
			) : query.isError ? (
				<p role="alert" className="text-sm">
					{query.error.message}
				</p>
			) : query.data.exceptions.length === 0 ? (
				<p className="bg-card rounded-xl border p-6 text-sm">
					No payment exceptions. Every payment so far was applied to its booking.
				</p>
			) : (
				<ul className="flex flex-col gap-4" aria-label="Open payment exceptions">
					{query.data.exceptions.map(exception => (
						<ExceptionCard key={exception.paymentId} exception={exception} />
					))}
				</ul>
			)}
		</section>
	)
}

function ExceptionCard({ exception }: { exception: PaymentException }) {
	const [resolving, setResolving] = useState(false)
	const reason = REASON_LABELS[exception.reason]

	return (
		<li className="bg-card flex flex-col gap-4 rounded-xl border p-4 sm:p-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<span className="font-mono text-base font-semibold">{exception.referenceNumber}</span>
					<span className="text-muted-foreground text-sm">
						{exception.clientName} · {exception.clientEmail ?? "No email"}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="destructive">{reason.label}</Badge>
					<Badge variant="secondary">
						Booking {bookingStatusLabel(exception.bookingStatus).toLowerCase()}
					</Badge>
				</div>
			</div>

			<dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
				<div>
					<dt className="text-muted-foreground">Amount</dt>
					<dd className="font-semibold">{pesos(exception.amountCentavos)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Channel</dt>
					<dd>
						{exception.channelCode} ({exception.providerCode})
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Paid</dt>
					<dd>{DATE_TIME.format(exception.paidAt)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Receipt</dt>
					<dd>{exception.receiptNumber ?? "None issued"}</dd>
				</div>
			</dl>
			<p className="text-muted-foreground text-sm">{reason.detail}</p>

			{resolving ? (
				<ResolveForm exception={exception} onCancel={() => setResolving(false)} />
			) : (
				<div>
					<Button type="button" onClick={() => setResolving(true)}>
						Resolve
					</Button>
				</div>
			)}
		</li>
	)
}

function ResolveForm({
	exception,
	onCancel,
}: {
	exception: PaymentException
	onCancel: () => void
}) {
	const resolve = useResolvePaymentExceptionMutation()
	const [resolution, setResolution] = useState<PaymentReviewResolution>("refund_requested")
	const [note, setNote] = useState("")
	const [reference, setReference] = useState("")
	const [error, setError] = useState<string | null>(null)

	async function submit(event: FormEvent) {
		event.preventDefault()
		setError(null)
		try {
			await resolve.mutateAsync({
				paymentId: exception.paymentId,
				resolution,
				note,
				...(resolution === "rebooked" ? { rebookedReferenceNumber: reference } : {}),
			})
			toast.success(
				resolution === "rebooked"
					? `Recorded: ${exception.referenceNumber} resolved by rebooking`
					: `Refund request opened for ${exception.referenceNumber}`
			)
		} catch (caught) {
			setError(
				caught instanceof ApiError && caught.status === 403
					? "Resolving payment exceptions needs the bookings.all:override permission. This attempt has been recorded."
					: caught instanceof Error
						? caught.message
						: "Could not resolve this exception"
			)
		}
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-4 border-t pt-4">
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">How was it resolved?</legend>
				<div className="flex flex-wrap gap-2">
					{(
						[
							["refund_requested", "Open a refund request"],
							["rebooked", "Rebooked the client"],
						] as const
					).map(([value, label]) => (
						<label
							key={value}
							htmlFor={`resolution-${exception.paymentId}-${value}`}
							className="has-[:checked]:border-primary flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
						>
							<input
								id={`resolution-${exception.paymentId}-${value}`}
								type="radio"
								name={`resolution-${exception.paymentId}`}
								value={value}
								checked={resolution === value}
								onChange={() => setResolution(value)}
								className="accent-primary size-4"
							/>
							{label}
						</label>
					))}
				</div>
			</fieldset>

			{resolution === "rebooked" ? (
				<div className="flex max-w-sm flex-col gap-2">
					<Label htmlFor={`rebooked-${exception.paymentId}`}>
						Reference Number of the new booking
					</Label>
					<Input
						id={`rebooked-${exception.paymentId}`}
						value={reference}
						onChange={event => setReference(event.target.value)}
						placeholder="QSPS-261124-AB12CD"
						autoComplete="off"
					/>
				</div>
			) : null}

			<div className="flex flex-col gap-2">
				<Label htmlFor={`note-${exception.paymentId}`}>Note</Label>
				<Textarea
					id={`note-${exception.paymentId}`}
					value={note}
					onChange={event => setNote(event.target.value)}
					rows={3}
					maxLength={1000}
					placeholder="What was agreed with the client"
				/>
			</div>

			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}

			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={resolve.isPending}>
					{resolve.isPending ? "Saving…" : "Save resolution"}
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	)
}
