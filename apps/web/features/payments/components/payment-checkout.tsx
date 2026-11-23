"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/core/components/ui/button"
import {
	useCheckoutChannelsQuery,
	useCreatePaymentMutation,
} from "@/features/payments/api/payments.hooks"
import { feeInPesos } from "@/features/services/lib/fee"

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

/**
 * Checkout for one booking (PAY-1, PAY-5). The client picks a channel and
 * sees its convenience fee and the total before confirming. The figures come
 * from the server, worked out by the same function that charges the payment,
 * so what is shown here is what is charged and printed on the e-Receipt.
 */
export function PaymentCheckout({
	bookingId,
	onRedirect,
}: {
	bookingId: number
	/** Called just before the browser leaves for the provider's checkout page. */
	onRedirect?: () => void
}) {
	const checkout = useCheckoutChannelsQuery(bookingId)
	const createPayment = useCreatePaymentMutation()
	const [channelCode, setChannelCode] = useState<string | null>(null)
	// Its own key, so a double click on "Pay now" opens one checkout, not two.
	const [paymentKey, setPaymentKey] = useState(newIdempotencyKey)

	const channels = checkout.data?.channels ?? []
	const selected = channels.find(channel => channel.code === channelCode) ?? null

	async function payNow() {
		if (!selected) return
		try {
			const result = await createPayment.mutateAsync({
				bookingId,
				channelCode: selected.code,
				idempotencyKey: paymentKey,
			})
			onRedirect?.()
			window.location.assign(result.checkoutUrl)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not start the payment")
			setPaymentKey(newIdempotencyKey())
		}
	}

	if (checkout.isPending) {
		return <p className="text-muted-foreground text-sm">Loading payment options…</p>
	}
	if (checkout.isError) {
		return <p role="alert">{checkout.error.message}</p>
	}
	if (channels.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				Online payment is not available right now. Your booking is saved; you can pay later.
			</p>
		)
	}

	return (
		<div className="flex flex-col gap-3">
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">Choose how to pay</legend>
				{channels.map(channel => (
					<label
						key={channel.code}
						htmlFor={`channel-${channel.code}`}
						className="border-border has-[:checked]:border-primary flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 text-sm"
					>
						<span className="flex items-center gap-2">
							<input
								id={`channel-${channel.code}`}
								type="radio"
								name="payment-channel"
								value={channel.code}
								checked={channelCode === channel.code}
								onChange={() => setChannelCode(channel.code)}
								className="accent-primary size-4"
							/>
							<span className="font-medium">{channel.name}</span>
						</span>
						<span className="text-muted-foreground">
							{channel.convenienceFeeCentavos > 0
								? `+ ₱${feeInPesos(channel.convenienceFeeCentavos)} fee`
								: "No fee"}
						</span>
					</label>
				))}
			</fieldset>

			{selected ? (
				<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" aria-live="polite">
					<dt className="text-muted-foreground">Service fees</dt>
					<dd className="text-right">₱{feeInPesos(checkout.data.subtotalCentavos)}</dd>
					<dt className="text-muted-foreground">Convenience fee ({selected.name})</dt>
					<dd className="text-right">₱{feeInPesos(selected.convenienceFeeCentavos)}</dd>
					<dt className="font-semibold">Total to pay</dt>
					<dd className="text-right font-semibold">₱{feeInPesos(selected.totalCentavos)}</dd>
				</dl>
			) : null}

			<div>
				<Button
					type="button"
					onClick={() => void payNow()}
					disabled={!selected || createPayment.isPending}
				>
					{createPayment.isPending
						? "Opening checkout…"
						: selected
							? `Pay ₱${feeInPesos(selected.totalCentavos)}`
							: "Choose how to pay"}
				</Button>
			</div>
		</div>
	)
}
