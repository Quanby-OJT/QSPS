import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { canAccess } from "@/features/dashboard/lib/access"
import { getAccess } from "@/features/dashboard/server/get-access"
import { AssessmentView } from "@/features/processing/components/assessment-view"

export const metadata: Metadata = {
	title: "Assessment",
}

export default async function AssessmentPage({
	params,
}: {
	params: Promise<{ bookingItemId: string }>
}) {
	const { bookingItemId } = await params
	const id = Number(bookingItemId)
	if (!Number.isInteger(id) || id <= 0) notFound()

	// PRC-3: show Approve, Send back and Override only to approvers. The API
	// still checks the key and Scope on every call.
	const access = await getAccess()
	const canApprove = canAccess(
		{ roles: access.roles, permissions: access.permissions },
		{ requiredPermission: "processing.assessments:approve" }
	)

	return <AssessmentView bookingItemId={id} canApprove={canApprove} />
}
