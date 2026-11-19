"use client"

import Link from "next/link"

import { useDocumentVerificationQuery } from "@/features/certificates/api/verification.hooks"
import { VerificationResult } from "@/features/certificates/components/verification-result"

export function VerificationShell({ children }: { children: React.ReactNode }) {
	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
			<div>
				<p className="text-muted-foreground text-sm">Bureau of Quarantine · QSPS</p>
				<h1 className="text-2xl font-bold">Document verification</h1>
			</div>
			{children}
		</main>
	)
}

/** The page a document's QR code opens (CRT-2). Public; reads only from QSPS. */
export function DocumentVerification({ token }: { token: string }) {
	const result = useDocumentVerificationQuery(token)

	return (
		<VerificationShell>
			<div className="border-border flex flex-col gap-3 rounded-lg border p-6" role="status">
				<VerificationResult isPending={result.isPending} error={result.error} data={result.data} />
			</div>
			<Link href="/verify" className="text-sm underline underline-offset-4">
				Check another document by its number
			</Link>
		</VerificationShell>
	)
}
