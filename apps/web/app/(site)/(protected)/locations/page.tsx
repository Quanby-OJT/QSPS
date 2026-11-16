import type { Metadata } from "next"

import { LocationsView } from "@/features/locations/components/locations-view"

export const metadata: Metadata = {
	title: "BOQ Locations",
}

export default function LocationsPage() {
	return <LocationsView />
}
