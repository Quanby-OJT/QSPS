import type { Metadata } from "next"

import { WalkInView } from "@/features/bookings/components/walk-in-view"

export const metadata: Metadata = {
	title: "Walk-in",
}

/** PRC-2: encode a walk-in client and book them into today's schedule. */
export default function WalkInPage() {
	return <WalkInView />
}
