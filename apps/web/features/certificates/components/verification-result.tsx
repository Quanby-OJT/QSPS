"use client"

import type { DocumentVerification } from "@repo/contracts"

import { Badge } from "@/core/components/ui/badge"
import { cn } from "@/core/lib/utils"
import { isRateLimited } from "@/features/certificates/api/verification.hooks"

function manilaDateTime(instant: Date): string {
	return new Intl.DateTimeFormat("en-PH", {
		timeZone: "Asia/Manila",
		dateStyle: "long",
		timeStyle: "short",
	}).format(instant)
}

const STATUS = {
	valid: {
		badge: "Valid document",
		heading: null,
		explanation: null,
	},
	revoked: {
		badge: "Revoked",
		heading: "This document has been REVOKED",
		explanation: "BOQ has withdrawn this document. It is no longer valid.",
	},
	superseded: {
		badge: "Superseded",
		heading: "This document has been SUPERSEDED",
		explanation: "A newer document replaced this one. Ask the holder for the current copy.",
	},
} as const

/**
 * What QSPS has on record for one document (CRT-2, TOR §VIII.4): type,
 * number, masked holder name, issuing office, issue date and status. Shared
 * by the QR page and the manual-entry page.
 */
export function VerificationResult({
	isPending,
	error,
	data,
}: {
	isPending: boolean
	error: Error | null
	data: DocumentVerification | null | undefined
}) {
	if (isPending) return <p>Checking the document…</p>

	if (error) {
		return (
			<p role="alert">
				{isRateLimited(error)
					? "Too many checks from your connection. Please wait a minute and try again."
					: "The document could not be checked right now. Please try again."}
			</p>
		)
	}

	if (!data) {
		return (
			<>
				<Badge variant="destructive">No record found</Badge>
				<p>No BOQ document matches these details.</p>
			</>
		)
	}

	const status = STATUS[data.status]
	return (
		<>
			{status.heading ? (
				<div
					role="alert"
					className="border-destructive bg-destructive/10 text-destructive flex flex-col gap-1 rounded-lg border-2 p-4"
				>
					<p className="text-lg font-bold">{status.heading}</p>
					<p className="text-sm">{status.explanation}</p>
					{data.statusChangedAt ? (
						<p className="text-sm font-medium">Since {manilaDateTime(data.statusChangedAt)}</p>
					) : null}
				</div>
			) : null}

			<Badge
				variant={data.status === "valid" ? "default" : "destructive"}
				className={cn(data.status === "valid" ? "" : "uppercase")}
			>
				{status.badge}
			</Badge>

			<dl className="grid gap-3 text-sm">
				<div>
					<dt className="text-muted-foreground">Document</dt>
					<dd className="text-base font-semibold">{data.documentTitle}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Document number</dt>
					<dd className="font-mono text-base font-semibold">{data.documentNumber}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Holder</dt>
					<dd className="font-mono">{data.holderName}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Issuing office</dt>
					<dd>{data.issuingLocation}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Date issued (Asia/Manila)</dt>
					<dd>{manilaDateTime(data.issuedAt)}</dd>
				</div>
			</dl>
			<p className="text-muted-foreground text-xs">
				These details come from the Bureau of Quarantine&apos;s QSPS records. If a printed document
				shows anything different, it has been altered. The holder&apos;s name is partly hidden to
				protect their privacy.
			</p>
		</>
	)
}
