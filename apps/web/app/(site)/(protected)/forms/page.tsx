import type { Metadata } from "next"

import { FormsOverview } from "@/features/forms/components/forms-overview"

export const metadata: Metadata = {
	title: "Forms",
}

/** FRM-1: the questionnaire for each Service. */
export default function FormsPage() {
	return <FormsOverview />
}
