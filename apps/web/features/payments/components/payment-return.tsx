"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	isWaitingForProvider,
	POLL_FOR_MS,
	receiptPdfUrl,
	usePaymentStatusQuery,
} from "@/features/payments/api/payments.hooks"
import { feeInPesos } from "@/features/services/lib/fee"

/**
 * Where the payment provider sends the client after checkout (PAY-1).
 *
 * Shows "confirming payment" and asks the API every few seconds until the
 * provider's signed notification has been processed. It never marks the
 * booking paid itself: arriving here proves nothing about the payment.
 *
 * Hydration-safe: the server and the client's first render both show
 * "Checking your payment…", even when the client already holds a restored
 * copy of the payment.
 */
export function PaymentReturn({ paymentId }: { paymentId: number | null }) {
	const [keepPolling, setKeepPolling] = useState(true)
	const payment = usePaymentStatusQuery(paymentId, keepPolling)
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()

	useEffect(() => {
		const timer = setTimeout(() => setKeepPolling(false), POLL_FOR_MS)
		return () => clearTimeout(timer)
	}, [])

	const loading = !hydrated || isQueryLoading(payment)
	// Nothing from the cache is shown until the page has hydrated.
	const data = loading ? undefined : payment.data
	const status = data?.status
	// Only "waiting" once the API has answered; before that we know nothing yet.
	const waiting = data !== undefined && isWaitingForProvider(status)

	return (
		<section className="mx-auto flex w-full max-w-xl flex-col gap-6">
			<PageHeader title="Payment" />

			{paymentId === null ? (
				<p role="alert">This link is missing its payment number.</p>
			) : !loading && payment.isError ? (
				<p role="alert">{payment.error.message}</p>
			) : (
				<div className="border-border flex flex-col gap-3 rounded-lg border p-6" role="status">
					{data ? (
						<p className="text-muted-foreground text-sm">
							Booking <span className="text-foreground font-mono">{data.referenceNumber}</span> · ₱
							{feeInPesos(data.amountCentavos)}
						</p>
					) : null}

					{loading ? <p className="text-muted-foreground">Checking your payment…</p> : null}

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
							{data?.receiptNumber ? (
								<div className="flex flex-col gap-1">
									<p className="text-muted-foreground text-sm">
										e-Receipt{" "}
										<span className="text-foreground font-mono">{data.receiptNumber}</span>
									</p>
									<div>
										<a
											href={receiptPdfUrl(paymentId)}
											target="_blank"
											rel="noopener noreferrer"
											className={buttonVariants({ variant: "default" })}
										>
											View or download e-Receipt (PDF)
										</a>
									</div>
								</div>
							) : null}
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
