import type { Metadata } from "next"

import { PaymentChannelsView } from "@/features/payments/components/payment-channels-view"

export const metadata: Metadata = {
	title: "Payment Channels",
}

export default function PaymentChannelsPage() {
	return <PaymentChannelsView />
}
