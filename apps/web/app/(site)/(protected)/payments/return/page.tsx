import type { Metadata } from "next"

import { PaymentReturn } from "@/features/payments/components/payment-return"

export const metadata: Metadata = {
	title: "Payment",
}

function readPaymentId(value: string | string[] | undefined): number | null {
	const id = Number(Array.isArray(value) ? value[0] : value)
	return Number.isInteger(id) && id > 0 ? id : null
}

export default async function PaymentReturnPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
	const { paymentId } = await searchParams
	return <PaymentReturn paymentId={readPaymentId(paymentId)} />
}
