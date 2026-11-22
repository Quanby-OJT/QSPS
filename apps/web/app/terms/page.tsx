import type { Metadata } from "next"

import { PublishedPoliciesView } from "@/features/policies/components/published-policies-view"

export const metadata: Metadata = {
	title: "Terms and policies",
	description: "The Bureau of Quarantine policies that apply when you book a service.",
}

/** The written policies in effect today (ADM-9). No sign-in. */
export default function TermsPage() {
	return <PublishedPoliciesView />
}
