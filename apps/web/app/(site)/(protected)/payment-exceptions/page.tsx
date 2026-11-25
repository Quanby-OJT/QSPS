import type { Metadata } from "next"

import { PaymentExceptionsView } from "@/features/payments/components/payment-exceptions-view"

export const metadata: Metadata = {
	title: "Payment exceptions",
}

/** PAY-6: late and duplicate payments staff must resolve. */
export default function PaymentExceptionsPage() {
	return <PaymentExceptionsView />
}
