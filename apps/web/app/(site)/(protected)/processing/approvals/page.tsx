import type { Metadata } from "next"

import { ApprovalsQueue } from "@/features/processing/components/approvals-queue"

export const metadata: Metadata = {
	title: "Approvals",
}

export default function ApprovalsPage() {
	return <ApprovalsQueue />
}
