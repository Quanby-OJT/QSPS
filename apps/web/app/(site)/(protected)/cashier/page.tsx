import type { Metadata } from "next"

import { CashierView } from "@/features/payments/components/cashier-view"

export const metadata: Metadata = {
	title: "Cashier",
}

/** PAY-4: collect an onsite payment at the cashier. */
export default function CashierPage() {
	return <CashierView />
}
