import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ServiceStepsView } from "@/features/services/components/service-steps-view"

export const metadata: Metadata = {
	title: "Service steps",
}

/** PRC-4: the ordered steps one Service's Booking Items pass through. */
export default async function ServiceStepsPage({
	params,
}: {
	params: Promise<{ serviceId: string }>
}) {
	const { serviceId } = await params
	const id = Number(serviceId)
	if (!Number.isInteger(id) || id <= 0) notFound()
	return <ServiceStepsView serviceId={id} />
}
