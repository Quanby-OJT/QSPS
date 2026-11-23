"use client"

import type { DocumentSummary } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { buttonVariants } from "@/core/components/ui/button"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { cn } from "@/core/lib/utils"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import { documentPdfUrl, useMyDocumentsQuery } from "@/features/certificates/api/certificates.hooks"

const issuedFormatter = new Intl.DateTimeFormat("en-PH", {
	timeZone: "Asia/Manila",
	dateStyle: "medium",
})

const DOCUMENT_TITLES: Record<DocumentSummary["documentType"], string> = {
	"icv-record": "International Certificate of Vaccination",
	// CRT-3: issued instead of the vaccination record when the client is medically exempt.
	"medical-exemption": "Medical Exemption Certificate",
}

const STATUS_LABELS: Record<DocumentSummary["status"], string> = {
	valid: "Valid",
	revoked: "Revoked",
	superseded: "Replaced",
}

/** "2036-11-29" → "Nov 29, 2036"; null means the document does not expire. */
function validUntilLabel(date: string | null): string {
	if (!date) return "Life of the person"
	const [year, month, day] = date.split("-").map(Number)
	return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", dateStyle: "medium" }).format(
		new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
	)
}

/**
 * My Documents (CRT-1): every document issued to the signed-in client, with
 * a link to its PDF. The PDF is generated from QSPS records each time.
 *
 * Hydration-safe: the server and the client's first render both show the
 * loading line, even when the client already holds a restored copy.
 */
export function MyDocuments() {
	const query = useMyDocumentsQuery()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()

	const loading = !hydrated || isQueryLoading(query)
	const documents = query.data?.documents ?? []

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				title="My documents"
				description="Certificates and records issued to you. Each one has a QR code anyone can scan to check it."
			/>
			{loading ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading…
				</p>
			) : query.error ? (
				<p className="text-destructive text-sm" role="alert">
					{query.error.message}
				</p>
			) : documents.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					You have no documents yet. A document appears here once BOQ staff clear your booking.
				</p>
			) : (
				<ul className="flex flex-col gap-3">
					{documents.map(document => (
						<li
							key={document.id}
							className="bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"
						>
							<div className="flex min-w-0 flex-col gap-1">
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-semibold">
										{DOCUMENT_TITLES[document.documentType] ?? document.documentType}
									</span>
									<Badge variant={document.status === "valid" ? "secondary" : "destructive"}>
										{STATUS_LABELS[document.status]}
									</Badge>
								</div>
								<span className="font-mono text-sm break-all">{document.documentNumber}</span>
								<span className="text-muted-foreground text-xs">
									{document.serviceName} · {document.locationName} · Issued{" "}
									{issuedFormatter.format(document.issuedAt)} · Valid until{" "}
									{validUntilLabel(document.validUntil)}
								</span>
								<span className="text-muted-foreground text-xs">
									Booking <span className="font-mono">{document.referenceNumber}</span>
								</span>
							</div>
							<a
								href={documentPdfUrl(document.id)}
								target="_blank"
								rel="noopener noreferrer"
								className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}
							>
								View or download PDF
							</a>
						</li>
					))}
				</ul>
			)}
		</section>
	)
}
