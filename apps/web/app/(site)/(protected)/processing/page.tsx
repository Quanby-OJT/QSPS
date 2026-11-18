import type { Metadata } from "next"

import { ProcessingQueue } from "@/features/processing/components/processing-queue"

export const metadata: Metadata = {
	title: "Processing",
}

export default function ProcessingPage() {
	return <ProcessingQueue />
}
