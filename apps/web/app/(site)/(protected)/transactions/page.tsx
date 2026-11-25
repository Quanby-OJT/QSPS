import type { Metadata } from "next"

import { MyTransactionsView } from "@/features/bookings/components/my-transactions"

export const metadata: Metadata = {
	title: "My Transactions",
}

export default function TransactionsPage() {
	return <MyTransactionsView />
}