"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { Button } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`
const PAGE_SIZE = 25

type Filters = {
	search: string
	dateFrom: string
	dateTo: string
	locationId: string
	serviceCategoryId: string
	status: string
	channel: string
	actor: string
}

type TransactionRow = {
	bookingId: number
	referenceNumber: string
	clientName: string
	clientEmail: string
	status: string
	kind: string
	totalCentavos: number
	createdAt: string
	serviceCount: number
	latestPaymentStatus: string | null
	latestChannel: string | null
	latestReceiptNumber: string | null
	lastActivityAt: string | null
	lastActor: string | null
}

type TransactionDetail = {
	booking: {
		id: number
		referenceNumber: string
		clientName: string
		clientEmail: string
		status: string
		kind: string
		totalCentavos: number
		createdAt: string
		updatedAt: string
	}
	items: {
		id: number
		serviceName: string
		serviceCategoryName: string
		locationName: string
		startsAt: string
		endsAt: string
		status: string
		feeCentavos: number
	}[]
	payments: {
		id: number
		status: string
		channelCode: string
		providerCode: string
		providerReference: string | null
		amountCentavos: number
		convenienceFeeCentavos: number
		needsReview: boolean
		collectedBy: string | null
		tenderType: string | null
		createdAt: string
		receiptNumber: string | null
	}[]
	documents: {
		id: number
		bookingItemId: number | null
		documentType: string
		documentNumber: string
		issuingLocation: string
		status: string
		issuedAt: string
		validUntil: string | null
		source: string
	}[]
	timeline: {
		id: number
		domain: string
		action: string
		outcome: string
		actorId: string | null
		actorEmail: string | null
		actorRole: string | null
		targetType: string | null
		targetId: string | null
		oldValue: unknown
		newValue: unknown
		reason: string | null
		createdAt: string
	}[]
}

function queryString(values: Record<string, string | number | undefined>) {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined && value !== "") params.set(key, String(value))
	}
	return params.toString()
}

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		credentials: "include",
		cache: "no-store",
	})

	if (!response.ok) {
		let message = `Request failed (${response.status})`
		try {
			const body = (await response.json()) as {
				message?: string
				error?: { message?: string }
			}
			message = body.error?.message ?? body.message ?? message
		} catch {
			// Keep the status message if the response is not JSON.
		}
		throw new Error(message)
	}

	return (await response.json()) as T
}

function formatDate(value: string | null) {
	if (!value) return "—"
	return new Intl.DateTimeFormat("en-PH", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Manila",
	}).format(new Date(value))
}

function formatMoney(centavos: number) {
	return new Intl.NumberFormat("en-PH", {
		style: "currency",
		currency: "PHP",
	}).format(centavos / 100)
}

function displayJson(value: unknown) {
	if (value === null || value === undefined) return "—"
	return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

export function TransactionMonitor() {
	const [filters, setFilters] = useState<Filters>({
		search: "",
		dateFrom: "",
		dateTo: "",
		locationId: "",
		serviceCategoryId: "",
		status: "",
		channel: "",
		actor: "",
	})
	const [page, setPage] = useState(1)
	const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null)
	const [exportError, setExportError] = useState<string | null>(null)

	const filterParams = {
		search: filters.search.trim() || undefined,
		dateFrom: filters.dateFrom || undefined,
		dateTo: filters.dateTo || undefined,
		locationId: filters.locationId || undefined,
		serviceCategoryId: filters.serviceCategoryId || undefined,
		status: filters.status || undefined,
		channel: filters.channel.trim() || undefined,
		actor: filters.actor.trim() || undefined,
	}

	const listQuery = useQuery({
		queryKey: ["reports", "transactions", filterParams, page],
		queryFn: () =>
			getJson<{
				page: number
				pageSize: number
				total: number
				rows: TransactionRow[]
			}>(
				`${API_BASE}/reports/transactions?${queryString({
					...filterParams,
					page,
					pageSize: PAGE_SIZE,
				})}`
			),
	})

	const detailQuery = useQuery({
		queryKey: ["reports", "transaction", selectedBookingId],
		enabled: selectedBookingId !== null,
		queryFn: () =>
			getJson<TransactionDetail>(`${API_BASE}/reports/transactions/${selectedBookingId}`),
	})

	function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
		setFilters(current => ({ ...current, [key]: value }))
		setPage(1)
	}

	async function download(format: "csv" | "pdf") {
		setExportError(null)
		try {
			const query = queryString({ ...filterParams, format })
			const result = await getJson<{
				fileName: string
				mimeType: string
				contentBase64: string
			}>(`${API_BASE}/reports/transactions/export?${query}`)

			const binary = atob(result.contentBase64)
			const bytes = new Uint8Array(binary.length)
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

			const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }))
			const link = document.createElement("a")
			link.href = url
			link.download = result.fileName
			document.body.appendChild(link)
			link.click()
			link.remove()
			URL.revokeObjectURL(url)
		} catch (error) {
			setExportError(error instanceof Error ? error.message : "Could not export transactions.")
		}
	}

	const total = listQuery.data?.total ?? 0
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Transaction monitor</CardTitle>
					<CardDescription>
						Search Bookings and review their Payments, Documents, and audit timeline.
						Dates and times are shown in Asia/Manila.
					</CardDescription>
				</CardHeader>

				<CardContent className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<label className="flex flex-col gap-1 text-sm">
							Search reference, client, or receipt number
							<input
								className="border-input bg-background h-9 rounded-md border px-3"
								value={filters.search}
								onChange={event => updateFilter("search", event.target.value)}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							Date from
							<input
								className="border-input bg-background h-9 rounded-md border px-3"
								type="date"
								value={filters.dateFrom}
								onChange={event => updateFilter("dateFrom", event.target.value)}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							Date to
							<input
								className="border-input bg-background h-9 rounded-md border px-3"
								type="date"
								value={filters.dateTo}
								onChange={event => updateFilter("dateTo", event.target.value)}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							Booking or Payment status
							<select
								className="border-input bg-background h-9 rounded-md border px-3"
								value={filters.status}
								onChange={event => updateFilter("status", event.target.value)}
							>
								<option value="">All statuses</option>
								{[
									"pending_approval",
									"pending_payment",
									"paid",
									"completed",
									"cancelled",
									"rejected",
									"forfeited",
									"refund_requested",
									"refunded",
									"initiated",
									"pending",
									"succeeded",
									"failed",
									"expired",
								].map(status => (
									<option key={status} value={status}>
										{status}
									</option>
								))}
							</select>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							Location ID
							<input
								className="border-input bg-background h-9 rounded-md border px-3"
								type="number"
								min="1"
								value={filters.locationId}
								onChange={event => updateFilter("locationId", event.target.value)}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							Service Category ID
							<input
								className="border-input bg-background h-9 rounded-md border px-3"
								type="number"
								min="1"
								value={filters.serviceCategoryId}
								onChange={event => updateFilter("serviceCategoryId", event.target.value)}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							Payment channel
							<input
								className="border-input bg-background h-9 rounded-md border px-3"
								placeholder="For example, onsite"
								value={filters.channel}
								onChange={event => updateFilter("channel", event.target.value)}
							/>
						</label>
						<label className="flex flex-col gap-1 text-sm">
							Acting user name, email, or ID
							<input
								className="border-input bg-background h-9 rounded-md border px-3"
								value={filters.actor}
								onChange={event => updateFilter("actor", event.target.value)}
							/>
						</label>
					</div>

					<div className="flex flex-wrap gap-2">
						<Button type="button" variant="outline" onClick={() => void download("csv")}>
							Export CSV
						</Button>
						<Button type="button" variant="outline" onClick={() => void download("pdf")}>
							Export PDF
						</Button>
						{exportError ? (
							<p className="text-destructive self-center text-sm" role="alert">
								{exportError}
							</p>
						) : null}
					</div>

					{listQuery.isLoading ? <p>Loading transactions…</p> : null}
					{listQuery.isError ? (
						<p className="text-destructive text-sm" role="alert">
							{listQuery.error.message}
						</p>
					) : null}

					<div className="overflow-x-auto">
						<table className="w-full text-left text-sm">
							<thead>
								<tr className="border-b">
									<th className="p-2">Reference</th>
									<th className="p-2">Client</th>
									<th className="p-2">Booking status</th>
									<th className="p-2">Latest payment</th>
									<th className="p-2">Total</th>
									<th className="p-2">Created (Manila)</th>
									<th className="p-2">Details</th>
								</tr>
							</thead>
							<tbody>
								{listQuery.data?.rows.map(row => (
									<tr key={row.bookingId} className="border-b">
										<td className="p-2 font-medium">{row.referenceNumber}</td>
										<td className="p-2">
											{row.clientName}
											<div className="text-muted-foreground">{row.clientEmail}</div>
										</td>
										<td className="p-2">{row.status}</td>
										<td className="p-2">
											{row.latestPaymentStatus ?? "—"}
											{row.latestReceiptNumber ? (
												<div className="text-muted-foreground">
													{row.latestReceiptNumber}
												</div>
											) : null}
										</td>
										<td className="p-2">{formatMoney(row.totalCentavos)}</td>
										<td className="p-2">{formatDate(row.createdAt)}</td>
										<td className="p-2">
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() => setSelectedBookingId(row.bookingId)}
											>
												Open
											</Button>
										</td>
									</tr>
								))}
								{listQuery.data?.rows.length === 0 ? (
									<tr>
										<td className="text-muted-foreground p-2" colSpan={7}>
											No matching Bookings.
										</td>
									</tr>
								) : null}
							</tbody>
						</table>
					</div>

					<div className="flex items-center justify-between gap-3">
						<p className="text-muted-foreground text-sm">
							{total} Booking{total === 1 ? "" : "s"} · Page {page} of {pageCount}
						</p>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								disabled={page <= 1}
								onClick={() => setPage(current => Math.max(1, current - 1))}
							>
								Previous
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={page >= pageCount}
								onClick={() => setPage(current => Math.min(pageCount, current + 1))}
							>
								Next
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{selectedBookingId !== null ? (
				<Card>
					<CardHeader>
						<CardTitle>Booking details</CardTitle>
						<CardDescription>
							<button
								type="button"
								className="underline"
								onClick={() => setSelectedBookingId(null)}
							>
								Close details
							</button>
						</CardDescription>
					</CardHeader>
					<CardContent>
						{detailQuery.isLoading ? <p>Loading Booking details…</p> : null}
						{detailQuery.isError ? (
							<p className="text-destructive text-sm" role="alert">
								{detailQuery.error.message}
							</p>
						) : null}
						{detailQuery.data ? (
							<DetailView detail={detailQuery.data} />
						) : null}
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}

function DetailView({ detail }: { detail: TransactionDetail }) {
	return (
		<div className="space-y-6">
			<section className="space-y-1">
				<h3 className="font-semibold">{detail.booking.referenceNumber}</h3>
				<p>
					{detail.booking.clientName} · {detail.booking.clientEmail}
				</p>
				<p>
					{detail.booking.status} · {formatMoney(detail.booking.totalCentavos)} · Created{" "}
					{formatDate(detail.booking.createdAt)}
				</p>
			</section>

			<section>
				<h3 className="mb-2 font-semibold">Booking items</h3>
				<ul className="space-y-2">
					{detail.items.map(item => (
						<li key={item.id} className="rounded-md border p-3">
							<strong>{item.serviceName}</strong> · {item.serviceCategoryName} ·{" "}
							{item.locationName}
							<div>
								{formatDate(item.startsAt)} – {formatDate(item.endsAt)} · {item.status} ·{" "}
								{formatMoney(item.feeCentavos)}
							</div>
						</li>
					))}
					{detail.items.length === 0 ? <li>No in-scope Booking items.</li> : null}
				</ul>
			</section>

			<section>
				<h3 className="mb-2 font-semibold">Payments</h3>
				<ul className="space-y-2">
					{detail.payments.map(payment => (
						<li key={payment.id} className="rounded-md border p-3">
							{payment.status} · {payment.channelCode} · {formatMoney(payment.amountCentavos)}
							<div>
								{payment.receiptNumber ?? "No receipt"} · {formatDate(payment.createdAt)}
								{payment.collectedBy ? ` · Collected by ${payment.collectedBy}` : ""}
								{payment.needsReview ? " · Needs review" : ""}
							</div>
						</li>
					))}
					{detail.payments.length === 0 ? <li>No Payments.</li> : null}
				</ul>
			</section>

			<section>
				<h3 className="mb-2 font-semibold">Documents</h3>
				<ul className="space-y-2">
					{detail.documents.map(document => (
						<li key={document.id} className="rounded-md border p-3">
							{document.documentNumber} · {document.documentType} · {document.status}
							<div>
								{document.issuingLocation} · Issued {formatDate(document.issuedAt)}
								{document.validUntil ? ` · Valid until ${document.validUntil}` : ""}
							</div>
						</li>
					))}
					{detail.documents.length === 0 ? <li>No Documents.</li> : null}
				</ul>
			</section>

			<section>
				<h3 className="mb-2 font-semibold">Audit timeline</h3>
				<ol className="space-y-2">
					{detail.timeline.map(event => (
						<li key={event.id} className="rounded-md border p-3">
							<strong>{event.action}</strong> · {event.domain} · {event.outcome}
							<div>
								{formatDate(event.createdAt)} · {event.actorEmail ?? event.actorId ?? "System"}
								{event.actorRole ? ` · ${event.actorRole}` : ""}
							</div>
							{event.reason ? <p>Reason: {event.reason}</p> : null}
							<details className="mt-2">
								<summary>Change details</summary>
								<pre className="overflow-x-auto whitespace-pre-wrap text-xs">
									Old: {displayJson(event.oldValue)}
									{"\n"}
									New: {displayJson(event.newValue)}
								</pre>
							</details>
						</li>
					))}
					{detail.timeline.length === 0 ? <li>No audit events recorded.</li> : null}
				</ol>
			</section>
		</div>
	)
}