import type { Metadata } from "next"

import { SchedulesView } from "@/features/schedules/components/schedules-view"

export const metadata: Metadata = {
	title: "Schedules",
}

export default function SchedulesPage() {
	return <SchedulesView />
}
