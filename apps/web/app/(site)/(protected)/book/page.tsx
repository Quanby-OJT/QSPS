import type { Metadata } from "next"

import { BookingWizard } from "@/features/bookings/components/booking-wizard"

export const metadata: Metadata = {
	title: "Book an appointment",
}

export default function BookPage() {
	return <BookingWizard />
}
