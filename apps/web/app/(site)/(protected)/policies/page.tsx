import type { Metadata } from "next"

import { PoliciesView } from "@/features/policies/components/policies-view"
import { PolicyDocumentsSection } from "@/features/policies/components/policy-documents-section"

export const metadata: Metadata = {
	title: "Policies",
}

/** ADM-6 rule values, then ADM-9 written booking terms. */
export default function PoliciesPage() {
	return (
		<div className="flex w-full flex-col gap-6">
			<PoliciesView />
			<PolicyDocumentsSection />
		</div>
	)
}
