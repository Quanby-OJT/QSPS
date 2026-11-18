"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import {
	isWaitingForProvider,
	POLL_FOR_MS,
	usePaymentStatusQuery,
} from "@/features/payments/api/payments.hooks"
import { feeInPesos } from "@/features/services/lib/fee"

/**
 * Where the payment provider sends the client after checkout (PAY-1).
 *
 * Shows "confirming payment" and asks the API every few seconds until the
 * provider's signed notification has been processed. It never marks the
 * booking paid itself: arriving here proves nothing about the payment.
 */
export function PaymentReturn({ paymentId }: { paymentId: number | null }) {
	const [keepPolling, setKeepPolling] = useState(true)
	const payment = usePaymentStatusQuery(paymentId, keepPolling)

	useEffect(() => {
		const timer = setTimeout(() => setKeepPolling(false), POLL_FOR_MS)
		return () => clearTimeout(timer)
	}, [])

	const status = payment.data?.status
	// Only "waiting" once the API has answered; before that we know nothing yet.
	const waiting = payment.data !== undefined && isWaitingForProvider(status)

	return (
		<section className="mx-auto flex max-w-xl flex-col gap-6">
			<PageHeader title="Payment" />

			{paymentId === null ? (
				<p role="alert">This link is missing its payment number.</p>
			) : payment.isError ? (
				<p role="alert">{payment.error.message}</p>
			) : (
				<div className="border-border flex flex-col gap-3 rounded-lg border p-6" role="status">
					{payment.data ? (
						<p className="text-muted-foreground text-sm">
							Booking{" "}
							<span className="text-foreground font-mono">{payment.data.referenceNumber}</span> · ₱
							{feeInPesos(payment.data.amountCentavos)}
						</p>
					) : null}

					{payment.isPending ? (
						<p className="text-muted-foreground">Checking your payment…</p>
					) : null}

					{waiting && keepPolling ? (
						<>
							<Badge variant="secondary">Confirming payment</Badge>
							<p>
								We are waiting for the payment provider to confirm your payment. This page updates
								by itself; please do not pay again.
							</p>
						</>
					) : null}

					{waiting && !keepPolling ? (
						<>
							<Badge variant="secondary">Still confirming</Badge>
							<p>
								The provider has not confirmed your payment yet. If you completed the payment, it
								will be confirmed automatically; check your booking again later.
							</p>
							<div>
								<Button type="button" variant="outline" onClick={() => setKeepPolling(true)}>
									Check again
								</Button>
							</div>
						</>
					) : null}

					{status === "succeeded" ? (
						<>
							<Badge>Paid</Badge>
							<p>Your payment is confirmed and your slot is secured.</p>
						</>
					) : null}

					{status === "failed" || status === "expired" ? (
						<>
							<Badge variant="destructive">Payment not completed</Badge>
							<p>
								The payment did not go through. Your booking is still waiting for payment until its
								hold ends.
							</p>
						</>
					) : null}

					<div>
						<Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
							Back to dashboard
						</Link>
					</div>
				</div>
			)}
		</section>
	)
}
