"use client"

import { AlertCircleIcon, Cancel01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { useHydrated } from "@/core/hooks/use-hydrated"
import { cn } from "@/core/lib/utils"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	verificationCard,
	VerificationShell,
} from "@/features/certificates/components/document-verification"
import { useReceiptVerificationQuery } from "@/features/payments/api/payments.hooks"
import { feeInPesos } from "@/features/services/lib/fee"

function manilaDateTime(instant: Date): string {
	return new Intl.DateTimeFormat("en-PH", {
		timeZone: "Asia/Manila",
		dateStyle: "long",
		timeStyle: "short",
	}).format(instant)
}

const tones = {
	valid: "bg-success/10 text-success border-success/30",
	muted: "bg-muted text-muted-foreground border-border",
	invalid: "bg-destructive/10 text-destructive border-destructive/30",
} as const

/** The coloured line at the top of a result: valid, refunded or not found. */
function StatusBanner({
	tone,
	icon,
	children,
}: {
	tone: keyof typeof tones
	icon: IconSvgElement
	children: React.ReactNode
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold",
				tones[tone]
			)}
		>
			<HugeiconsIcon icon={icon} strokeWidth={2} className="size-5 shrink-0" />
			{children}
		</div>
	)
}

/**
 * Shows what QSPS has on record for a scanned e-Receipt: number, amount,
 * date and status, read from the database. Nothing about the client.
 *
 * Hydration-safe: the server and the client's first render both show
 * "Checking the receipt…", even when the client already holds a restored copy.
 */
export function ReceiptVerification({ token }: { token: string }) {
	const receipt = useReceiptVerificationQuery(token)
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()

	const loading = !hydrated || isQueryLoading(receipt)
	// undefined: not known yet. null: no receipt matches this code.
	const data = loading ? undefined : receipt.data

	return (
		<VerificationShell
			title="e-Receipt verification"
			description="What QSPS has on record for this receipt."
		>
			<div className={verificationCard} role="status">
				{loading ? <p className="text-muted-foreground text-sm">Checking the receipt…</p> : null}

				{!loading && receipt.isError ? (
					<p role="alert" className="text-destructive text-sm">
						The receipt could not be checked right now. Please try again.
					</p>
				) : null}

				{data === null ? (
					<>
						<StatusBanner tone="invalid" icon={Cancel01Icon}>
							No record found
						</StatusBanner>
						<p className="text-sm">No QSPS e-Receipt matches this code.</p>
					</>
				) : null}

				{data ? (
					<>
						{data.status === "valid" ? (
							<StatusBanner tone="valid" icon={CheckmarkCircle02Icon}>
								Valid receipt
							</StatusBanner>
						) : (
							<StatusBanner tone="muted" icon={AlertCircleIcon}>
								Refunded
							</StatusBanner>
						)}
						<dl className="divide-border grid divide-y text-sm">
							<div className="flex flex-col gap-0.5 py-3 first:pt-0">
								<dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
									Receipt number
								</dt>
								<dd className="font-mono text-base font-semibold break-all">
									{data.receiptNumber}
								</dd>
							</div>
							<div className="flex flex-col gap-0.5 py-3">
								<dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
									Amount paid
								</dt>
								<dd className="text-lg font-bold">₱{feeInPesos(data.amountCentavos)}</dd>
							</div>
							<div className="flex flex-col gap-0.5 py-3 last:pb-0">
								<dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
									Date issued (Asia/Manila)
								</dt>
								<dd>{manilaDateTime(data.issuedAt)}</dd>
							</div>
						</dl>
						<p className="text-muted-foreground border-t pt-4 text-xs">
							These details come from QSPS records. If a printed receipt shows anything different,
							it has been altered.
						</p>
					</>
				) : null}
			</div>
		</VerificationShell>
	)
}
