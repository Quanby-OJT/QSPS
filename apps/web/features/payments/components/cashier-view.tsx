"use client"

import { useCallback, useState, type FormEvent } from "react"
import { Search01Icon, Ticket01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import type { CashierBooking, CollectOnsiteResult, TenderType } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { ApiError } from "@/core/lib/api-error"
import {
	cashierReceiptUrl,
	useCashierSearchQuery,
	useCollectOnsiteMutation,
} from "@/features/payments/api/cashier.hooks"
import {
	canScanWithCamera,
	QrCameraScanner,
} from "@/features/payments/components/qr-camera-scanner"
import {
	bookingStatusLabel,
	canCollect,
	checkAmountReceived,
	TENDER_LABELS,
} from "@/features/payments/lib/cashier"
import { slotTimeRange } from "@/features/schedules/lib/calendar"
import { feeInPesos } from "@/features/services/lib/fee"

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

function pesos(centavos: number): string {
	return `₱${Number(feeInPesos(centavos)).toLocaleString("en-PH", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
	timeZone: "Asia/Manila",
	weekday: "short",
	month: "short",
	day: "numeric",
	year: "numeric",
})

/**
 * Cashier (PAY-4, TOR §VIII.1): find a client's booking by Reference Number
 * (typed, scanned with a handheld scanner, or read by the camera), email or
 * name, check the fee breakdown, record the payment and print the receipt.
 *
 * Read-only apart from recording the payment: nothing here edits the client
 * or the schedule (Annex A).
 */
export function CashierView() {
	const [text, setText] = useState("")
	const [query, setQuery] = useState<string | null>(null)
	const [selectedId, setSelectedId] = useState<number | null>(null)
	const [scanning, setScanning] = useState(false)
	const search = useCashierSearchQuery(query)

	const results = search.data?.bookings ?? []
	const selected = results.find(booking => booking.bookingId === selectedId) ?? null

	const runSearch = useCallback((value: string) => {
		const trimmed = value.trim()
		if (trimmed.length < 3) {
			toast.error("Enter a Reference Number, an email or at least 3 letters of a name")
			return
		}
		setText(trimmed)
		setQuery(trimmed)
		setSelectedId(null)
	}, [])

	const onScan = useCallback(
		(value: string) => {
			setScanning(false)
			runSearch(value)
		},
		[runSearch]
	)

	function submit(event: FormEvent) {
		event.preventDefault()
		runSearch(text)
	}

	function startOver() {
		setText("")
		setQuery(null)
		setSelectedId(null)
	}

	const forbidden = search.error instanceof ApiError && search.error.status === 403
	// One result (a scanned Reference Number) opens straight away.
	const shown = selected ?? (results.length === 1 ? results[0] : null)

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={Ticket01Icon}
				title="Cashier"
				description="Find the client's booking, check the fees, record the payment and print the receipt."
			/>

			<form
				onSubmit={submit}
				className="bg-card flex flex-wrap items-end gap-3 rounded-xl border p-4"
			>
				<div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
					<Label htmlFor="cashier-search">
						Scan the QR code, or enter the Reference Number, email or name
					</Label>
					<Input
						id="cashier-search"
						value={text}
						onChange={event => setText(event.target.value)}
						placeholder="QSPS-261124-AB12CD, sam@example.com or Rivera"
						autoComplete="off"
						autoFocus
					/>
				</div>
				<Button type="submit" disabled={search.isFetching}>
					<HugeiconsIcon icon={Search01Icon} strokeWidth={2} data-icon="inline-start" />
					{search.isFetching ? "Searching…" : "Search"}
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={() => {
						if (!canScanWithCamera()) {
							toast.error(
								"This browser cannot read QR codes from the camera. Use a handheld scanner or type the Reference Number."
							)
							return
						}
						setScanning(true)
					}}
				>
					Scan with camera
				</Button>
			</form>

			{scanning ? <QrCameraScanner onScan={onScan} onClose={() => setScanning(false)} /> : null}

			{forbidden ? (
				<p role="alert" className="text-sm">
					You do not have access to the cashier. Collecting payments needs the
					payments.onsite:collect permission. This attempt has been recorded.
				</p>
			) : search.isError ? (
				<p role="alert" className="text-sm">
					{search.error.message}
				</p>
			) : query && !search.isFetching && results.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No booking matches “{query}” at your location.
				</p>
			) : null}

			{results.length > 1 && !selected ? (
				<ul className="bg-card divide-y rounded-xl border" aria-label="Matching bookings">
					{results.map(booking => (
						<li key={booking.bookingId}>
							<button
								type="button"
								onClick={() => setSelectedId(booking.bookingId)}
								className="hover:bg-muted flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left"
							>
								<span className="flex flex-col">
									<span className="font-mono text-sm font-semibold">{booking.referenceNumber}</span>
									<span className="text-muted-foreground text-sm">
										{booking.clientName} · {booking.clientEmail ?? "No email"}
									</span>
								</span>
								<span className="flex items-center gap-3">
									<StatusBadge status={booking.status} />
									<span className="font-semibold">{pesos(booking.totalCentavos)}</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			) : null}

			{shown ? (
				<BookingPanel
					key={shown.bookingId}
					booking={shown}
					onBack={results.length > 1 ? () => setSelectedId(null) : undefined}
					onDone={startOver}
				/>
			) : null}
		</section>
	)
}

function StatusBadge({ status }: { status: CashierBooking["status"] }) {
	const variant =
		status === "pending_payment"
			? "default"
			: status === "paid" || status === "completed"
				? "secondary"
				: "destructive"
	return <Badge variant={variant}>{bookingStatusLabel(status)}</Badge>
}

function ReceiptButtons({ paymentId }: { paymentId: number }) {
	return (
		<div className="flex flex-wrap gap-2">
			<Button
				type="button"
				onClick={() => window.open(cashierReceiptUrl(paymentId, "a4"), "_blank", "noopener")}
			>
				Print receipt (A4)
			</Button>
			<Button
				type="button"
				variant="outline"
				onClick={() => window.open(cashierReceiptUrl(paymentId, "passbook"), "_blank", "noopener")}
			>
				Print on passbook printer
			</Button>
		</div>
	)
}

/** One booking: its fee breakdown, then collecting or its current status. */
function BookingPanel({
	booking,
	onBack,
	onDone,
}: {
	booking: CashierBooking
	onBack?: () => void
	onDone: () => void
}) {
	const [result, setResult] = useState<CollectOnsiteResult | null>(null)

	return (
		<div className="bg-card flex flex-col gap-5 rounded-xl border p-4 sm:p-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<span className="font-mono text-lg font-semibold">{booking.referenceNumber}</span>
					<span className="text-muted-foreground text-sm">
						{booking.clientName} · {booking.clientEmail ?? "No email"}
					</span>
				</div>
				<StatusBadge status={result ? "paid" : booking.status} />
			</div>

			<table className="w-full text-sm">
				<caption className="sr-only">Fee breakdown</caption>
				<thead>
					<tr className="text-muted-foreground border-b text-left">
						<th className="py-2 font-medium">Service</th>
						<th className="py-2 font-medium">Schedule</th>
						<th className="py-2 text-right font-medium">Fee</th>
					</tr>
				</thead>
				<tbody>
					{booking.items.map(item => (
						<tr
							key={`${item.serviceName}-${item.startsAt.toISOString()}`}
							className="border-b align-top"
						>
							<td className="py-2">{item.serviceName}</td>
							<td className="text-muted-foreground py-2">
								{item.locationName} · {DATE_FORMAT.format(item.startsAt)} · {slotTimeRange(item)}
							</td>
							<td className="py-2 text-right">{pesos(item.feeCentavos)}</td>
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr>
						<td colSpan={2} className="pt-3 font-semibold">
							Amount due (no convenience fee at the cashier)
						</td>
						<td className="pt-3 text-right text-base font-semibold">
							{pesos(booking.totalCentavos)}
						</td>
					</tr>
				</tfoot>
			</table>

			{result ? (
				<div className="flex flex-col gap-3" aria-live="polite">
					<p className="font-medium">
						Payment recorded. Receipt {result.receiptNumber}
						{result.changeCentavos > 0 ? ` · Change ${pesos(result.changeCentavos)}` : ""}
					</p>
					<ReceiptButtons paymentId={result.paymentId} />
				</div>
			) : canCollect(booking) ? (
				<CollectForm booking={booking} onCollected={setResult} />
			) : (
				<div className="flex flex-col gap-3">
					<p role="status" className="text-sm">
						This booking cannot be paid here: it is{" "}
						{bookingStatusLabel(booking.status).toLowerCase()}.
					</p>
					{booking.paidPayment ? (
						<>
							<p className="text-muted-foreground text-sm">
								Receipt {booking.paidPayment.receiptNumber ?? "not issued yet"}. You can print it
								again.
							</p>
							<ReceiptButtons paymentId={booking.paidPayment.paymentId} />
						</>
					) : null}
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				{onBack && !result ? (
					<Button type="button" variant="ghost" onClick={onBack}>
						Back to results
					</Button>
				) : null}
				<Button type="button" variant="outline" onClick={onDone}>
					Next client
				</Button>
			</div>
		</div>
	)
}

function CollectForm({
	booking,
	onCollected,
}: {
	booking: CashierBooking
	onCollected: (result: CollectOnsiteResult) => void
}) {
	const collect = useCollectOnsiteMutation()
	const [tenderType, setTenderType] = useState<TenderType>("cash")
	const [received, setReceived] = useState(() => feeInPesos(booking.totalCentavos))
	// Its own key, so a double click records one Payment, not two.
	const [collectKey, setCollectKey] = useState(newIdempotencyKey)
	const [error, setError] = useState<string | null>(null)

	const amount = checkAmountReceived(received, booking.totalCentavos, tenderType)

	async function confirm(event: FormEvent) {
		event.preventDefault()
		if (!amount.ok) {
			setError(amount.message)
			return
		}
		setError(null)
		try {
			const result = await collect.mutateAsync({
				bookingId: booking.bookingId,
				tenderType,
				amountDueCentavos: booking.totalCentavos,
				amountReceivedCentavos: amount.receivedCentavos,
				idempotencyKey: collectKey,
			})
			toast.success(`Payment recorded. Receipt ${result.receiptNumber}`)
			onCollected(result)
		} catch (caught) {
			// A refusal (already paid, cancelled, amount changed) says why; a new
			// key lets the cashier try again after reloading.
			setError(caught instanceof Error ? caught.message : "Could not record the payment")
			setCollectKey(newIdempotencyKey())
		}
	}

	return (
		<form onSubmit={confirm} className="flex flex-col gap-4">
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">Tender</legend>
				<div className="flex flex-wrap gap-2">
					{(Object.keys(TENDER_LABELS) as TenderType[]).map(tender => (
						<label
							key={tender}
							htmlFor={`tender-${tender}`}
							className="has-[:checked]:border-primary flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
						>
							<input
								id={`tender-${tender}`}
								type="radio"
								name="tender"
								value={tender}
								checked={tenderType === tender}
								onChange={() => {
									setTenderType(tender)
									if (tender !== "cash") setReceived(feeInPesos(booking.totalCentavos))
								}}
								className="accent-primary size-4"
							/>
							{TENDER_LABELS[tender]}
						</label>
					))}
				</div>
			</fieldset>

			<div className="flex max-w-xs flex-col gap-2">
				<Label htmlFor="amount-received">Amount received (₱)</Label>
				<Input
					id="amount-received"
					inputMode="decimal"
					value={received}
					onChange={event => setReceived(event.target.value)}
					disabled={tenderType !== "cash"}
				/>
				{amount.ok && amount.changeCentavos > 0 ? (
					<p className="text-sm font-medium">Change: {pesos(amount.changeCentavos)}</p>
				) : null}
			</div>

			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}

			<div>
				<Button type="submit" disabled={collect.isPending}>
					{collect.isPending ? "Recording…" : `Confirm payment of ${pesos(booking.totalCentavos)}`}
				</Button>
			</div>
		</form>
	)
}
