"use client"

import { Cancel01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import type { DocumentVerification } from "@repo/contracts"

import { cn } from "@/core/lib/utils"
import { isRateLimited } from "@/features/certificates/api/verification.hooks"

function manilaDateTime(instant: Date): string {
	return new Intl.DateTimeFormat("en-PH", {
		timeZone: "Asia/Manila",
		dateStyle: "long",
		timeStyle: "short",
	}).format(instant)
}

/** A calendar day such as 2027-11-18, shown as written: no time zone shifts it. */
function calendarDate(value: string): string {
	return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", dateStyle: "long" }).format(
		new Date(`${value}T00:00:00Z`)
	)
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
	expired: {
		badge: "Expired",
		heading: "This document has EXPIRED",
		explanation: "Its validity period has ended. Ask the holder for a current document.",
	},
} as const

const tones = {
	valid: "bg-success/10 text-success border-success/30",
	invalid: "bg-destructive/10 text-destructive border-destructive/30",
} as const

/** The coloured bar at the top of a result (UI-1): green when valid, red otherwise. */
function StatusBanner({
	tone,
	icon,
	className,
	children,
}: {
	tone: keyof typeof tones
	icon: IconSvgElement
	className?: string
	children: React.ReactNode
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold",
				tones[tone],
				className
			)}
		>
			<HugeiconsIcon icon={icon} strokeWidth={2} className="size-5 shrink-0" />
			{children}
		</div>
	)
}

/** One labelled line of the record, split from the next by a thin rule. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
			<dt className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
				{label}
			</dt>
			{children}
		</div>
	)
}

/**
 * What QSPS has on record for one document (CRT-2, TOR §VIII.4): type,
 * number, masked holder name, issuing office, issue date, valid-until date
 * (CRT-5) and status. Shared by the QR page and the manual-entry page.
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
	if (isPending) return <p className="text-muted-foreground text-sm">Checking the document…</p>

	if (error) {
		return (
			<p role="alert" className="text-destructive text-sm">
				{isRateLimited(error)
					? "Too many checks from your connection. Please wait a minute and try again."
					: "The document could not be checked right now. Please try again."}
			</p>
		)
	}

	if (!data) {
		return (
			<>
				<StatusBanner tone="invalid" icon={Cancel01Icon}>
					No record found
				</StatusBanner>
				<p className="text-sm">No BOQ document matches these details.</p>
			</>
		)
	}

	const status = STATUS[data.status]
	const isValid = data.status === "valid"
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

			<StatusBanner
				tone={isValid ? "valid" : "invalid"}
				icon={isValid ? CheckmarkCircle02Icon : Cancel01Icon}
				className={isValid ? undefined : "uppercase"}
			>
				{status.badge}
			</StatusBanner>

			<dl className="divide-border grid divide-y text-sm">
				<Field label="Document">
					<dd className="text-base font-semibold">{data.documentTitle}</dd>
				</Field>
				<Field label="Document number">
					<dd className="font-mono text-base font-semibold">{data.documentNumber}</dd>
				</Field>
				<Field label="Holder">
					<dd className="font-mono">{data.holderName}</dd>
				</Field>
				<Field label="Issuing office">
					<dd>{data.issuingLocation}</dd>
				</Field>
				<Field label="Date issued (Asia/Manila)">
					<dd>{manilaDateTime(data.issuedAt)}</dd>
				</Field>
				{data.documentType === "water-analysis-certificate" && data.analysisOutcome ? (
					<Field label="Water analysis outcome">
						<dd className="font-semibold">
							{data.analysisOutcome === "fail" ? "FAILED" : "PASSED"}
						</dd>
					</Field>
				) : null}
				{data.validUntil ? (
					<Field label="Valid until">
						<dd>{calendarDate(data.validUntil)}</dd>
					</Field>
				) : null}
			</dl>
			<p className="text-muted-foreground border-t pt-4 text-xs">
				These details come from the Bureau of Quarantine&apos;s QSPS records. If a printed document
				shows anything different, it has been altered. The holder&apos;s name is partly hidden to
				protect their privacy.
			</p>
		</>
	)
}
