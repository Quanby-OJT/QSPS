import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { FormBuilderView } from "@/features/forms/components/form-builder-view"

export const metadata: Metadata = {
	title: "Form builder",
}

/** FRM-1: build, version and publish one Service's questionnaire. */
export default async function FormBuilderPage({
	params,
}: {
	params: Promise<{ serviceId: string }>
}) {
	const { serviceId } = await params
	const id = Number(serviceId)
	if (!Number.isInteger(id) || id <= 0) notFound()
	return <FormBuilderView serviceId={id} />
}
