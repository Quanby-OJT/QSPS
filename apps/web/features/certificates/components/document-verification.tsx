"use client"

import Link from "next/link"

import { useDocumentVerificationQuery } from "@/features/certificates/api/verification.hooks"
import { VerificationResult } from "@/features/certificates/components/verification-result"

/** Card around a form or a result on the public verification pages (UI-1). */
export const verificationCard =
	"bg-card text-card-foreground flex flex-col gap-4 rounded-xl border p-6 shadow-sm sm:p-8"

/**
 * Heading and column for the public verification pages (CRT-2, PAY-2). The
 * page frame (BOQ header and footer) comes from PublicShell in the route
 * layout, so this only sets the heading and the width.
 */
export function VerificationShell({
	title = "Document verification",
	description,
	children,
}: {
	title?: string
	description?: React.ReactNode
	children: React.ReactNode
}) {
	return (
		<div className="mx-auto flex w-full max-w-lg flex-col gap-6">
			<div>
				<div className="bg-gold mb-3 h-1 w-12 rounded-full" />
				<p className="text-primary text-xs font-bold tracking-widest uppercase">
					Bureau of Quarantine · QSPS
				</p>
				<h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
				{description ? <p className="text-muted-foreground mt-2 text-sm">{description}</p> : null}
			</div>
			{children}
		</div>
	)
}

/** The page a document's QR code opens (CRT-2). Public; reads only from QSPS. */
export function DocumentVerification({ token }: { token: string }) {
	const result = useDocumentVerificationQuery(token)

	return (
		<VerificationShell description="What QSPS has on record for this document.">
			<div className={verificationCard} role="status">
				<VerificationResult isPending={result.isPending} error={result.error} data={result.data} />
			</div>
			<Link
				href="/verify"
				className="text-primary self-start text-sm font-semibold hover:underline"
			>
				Check another document by its number →
			</Link>
		</VerificationShell>
	)
}
