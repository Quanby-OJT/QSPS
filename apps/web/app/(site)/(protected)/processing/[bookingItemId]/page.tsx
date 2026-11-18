import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { AssessmentView } from "@/features/processing/components/assessment-view"

export const metadata: Metadata = {
	title: "Assessment",
}

export default async function AssessmentPage({
	params,
}: {
	params: Promise<{ bookingItemId: string }>
}) {
	const { bookingItemId } = await params
	const id = Number(bookingItemId)
	if (!Number.isInteger(id) || id <= 0) notFound()
	return <AssessmentView bookingItemId={id} />
}
