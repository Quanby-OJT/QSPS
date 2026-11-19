import type { Metadata } from "next"

import { MyDocuments } from "@/features/certificates/components/my-documents"

export const metadata: Metadata = {
	title: "My documents",
}

export default function MyDocumentsPage() {
	return <MyDocuments />
}
