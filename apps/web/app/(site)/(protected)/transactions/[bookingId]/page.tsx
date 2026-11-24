import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { BookingDetailView } from "@/features/bookings/components/booking-detail"

export const metadata: Metadata = {
	title: "Booking Details",
}

export default async function BookingDetailPage({
	params,
}: {
	params: Promise<{ bookingId: string }>
}) {
	const { bookingId } = await params
	const parsedId = Number(bookingId)
	if (!Number.isInteger(parsedId) || parsedId <= 0) {
		notFound()
	}

	return <BookingDetailView bookingId={parsedId} />
}