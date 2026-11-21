import type { Metadata } from "next"

import { PoliciesView } from "@/features/policies/components/policies-view"

export const metadata: Metadata = {
	title: "Policies",
}

export default function PoliciesPage() {
	return <PoliciesView />
}
