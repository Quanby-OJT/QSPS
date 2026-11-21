import type { Metadata } from "next"

import { DocumentVerification } from "@/features/certificates/components/document-verification"

export const metadata: Metadata = {
	title: "Verify document",
	// Each token is private to its document; keep these pages out of search.
	robots: { index: false, follow: false },
}

/**
 * Public page behind a document's QR code (CRT-2, Flow D step 5). Outside
 * the (protected) group, so anyone can open it without signing in.
 */
export default async function VerifyDocumentPage({
	params,
}: {
	params: Promise<{ token: string }>
}) {
	const { token } = await params
	return <DocumentVerification token={token} />
}
