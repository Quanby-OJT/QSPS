import type { Metadata } from "next"

import { TransactionMonitor } from "@/features/reports/components/transaction-monitor"

export const metadata: Metadata = {
	title: "Transaction monitor",
}

export default function TransactionsPage() {
	return <TransactionMonitor />
}
