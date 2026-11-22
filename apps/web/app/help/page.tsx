import type { Metadata } from "next"

import { HelpView } from "@/features/support/components/help-view"

export const metadata: Metadata = {
	title: "Help",
	description: "How to reach the Bureau of Quarantine help desk.",
}

/** The help desk contacts (ADM-8, TOR §IX). No sign-in. */
export default function HelpPage() {
	return <HelpView />
}
