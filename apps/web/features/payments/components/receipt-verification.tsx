"use client"

import { Badge } from "@/core/components/ui/badge"
import { useReceiptVerificationQuery } from "@/features/payments/api/payments.hooks"
import { feeInPesos } from "@/features/services/lib/fee"

function manilaDateTime(instant: Date): string {
	return new Intl.DateTimeFormat("en-PH", {
		timeZone: "Asia/Manila",
		dateStyle: "long",
		timeStyle: "short",
	}).format(instant)
}

/**
 * Shows what QSPS has on record for a scanned e-Receipt: number, amount,
 * date and status, read from the database. Nothing about the client.
 */
export function ReceiptVerification({ token }: { token: string }) {
	const receipt = useReceiptVerificationQuery(token)

	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
			<div>
				<p className="text-muted-foreground text-sm">Bureau of Quarantine · QSPS</p>
				<h1 className="text-2xl font-bold">e-Receipt verification</h1>
			</div>

			<div className="border-border flex flex-col gap-3 rounded-lg border p-6" role="status">
				{receipt.isPending ? <p>Checking the receipt…</p> : null}

				{receipt.isError ? (
					<p role="alert">The receipt could not be checked right now. Please try again.</p>
				) : null}

				{receipt.data === null ? (
					<>
						<Badge variant="destructive">No record found</Badge>
						<p>No QSPS e-Receipt matches this code.</p>
					</>
				) : null}

				{receipt.data ? (
					<>
						<Badge variant={receipt.data.status === "valid" ? "default" : "secondary"}>
							{receipt.data.status === "valid" ? "Valid receipt" : "Refunded"}
						</Badge>
						<dl className="grid gap-3 text-sm">
							<div>
								<dt className="text-muted-foreground">Receipt number</dt>
								<dd className="font-mono text-base font-semibold">{receipt.data.receiptNumber}</dd>
							</div>
							<div>
								<dt className="text-muted-foreground">Amount paid</dt>
								<dd className="text-base font-semibold">
									₱{feeInPesos(receipt.data.amountCentavos)}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground">Date issued (Asia/Manila)</dt>
								<dd>{manilaDateTime(receipt.data.issuedAt)}</dd>
							</div>
						</dl>
						<p className="text-muted-foreground text-xs">
							These details come from QSPS records. If a printed receipt shows anything different,
							it has been altered.
						</p>
					</>
				) : null}
			</div>
		</main>
	)
}
