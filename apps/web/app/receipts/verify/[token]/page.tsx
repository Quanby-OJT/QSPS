import type { Metadata } from "next"

import { ReceiptVerification } from "@/features/payments/components/receipt-verification"

export const metadata: Metadata = {
	title: "Verify e-Receipt",
	// Each token is private to its receipt; keep these pages out of search.
	robots: { index: false, follow: false },
}

/**
 * Public page behind an e-Receipt's QR code (PAY-2). Outside the
 * (protected) group, so anyone can open it without signing in.
 */
export default async function VerifyReceiptPage({
	params,
}: {
	params: Promise<{ token: string }>
}) {
	const { token } = await params
	return <ReceiptVerification token={token} />
}
