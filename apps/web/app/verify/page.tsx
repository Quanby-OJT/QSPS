import type { Metadata } from "next"

import { ManualVerification } from "@/features/certificates/components/manual-verification"

export const metadata: Metadata = {
	title: "Verify a document",
	robots: { index: false, follow: false },
}

/** Public manual verification by Document Number and code (CRT-2). No sign-in. */
export default function ManualVerifyPage() {
	return <ManualVerification />
}
