"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"

import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { useLocationsQuery } from "@/features/locations/api/locations.hooks"
import { bookingStatusLabel } from "@/features/payments/lib/cashier"
import { useServiceCategoriesQuery } from "@/features/services/api/services.hooks"
import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`
const PAGE_SIZE = 25
const DASH = "—"
const DOT = " · "

const FIELD =
	"border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2"
const LABEL = "text-muted-foreground flex flex-col gap-1.5 text-xs font-medium"

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

const EMPTY_FILTERS: Filters = {
	search: "",
	dateFrom: "",
	dateTo: "",
	locationId: "",
	serviceCategoryId: "",
	status: "",
	channel: "",
	actor: "",
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

const BOOKING_STATUSES = [
	"pending_approval",
	"pending_payment",
	"paid",
	"completed",
	"cancelled",
	"rejected",
	"forfeited",
	"refund_requested",
	"refunded",
]
const PAYMENT_STATUSES = ["initiated", "pending", "succeeded", "failed", "expired"]

function titleCase(value: string) {
	const text = value.replaceAll("_", " ").replaceAll(".", " ")
	return text.charAt(0).toUpperCase() + text.slice(1)
}

function bookingLabel(status: string) {
	const label: string | undefined = bookingStatusLabel(
		status as Parameters<typeof bookingStatusLabel>[0]
	)
	return label ?? titleCase(status)
}

function statusVariant(status: string) {
	if (["cancelled", "rejected", "forfeited", "failed", "expired", "revoked"].includes(status))
		return "destructive" as const
	if (["paid", "completed", "refunded", "succeeded", "valid", "issued"].includes(status))
		return "default" as const
	return "secondary" as const
}

function queryString(values: Record<string, string | number | undefined>) {
	const params = new URLSearchParams()
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined && value !== "") params.set(key, String(value))
	}
	return params.toString()
}

async function getJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { credentials: "include", cache: "no-store" })

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
	if (!value) return DASH
	return new Intl.DateTimeFormat("en-PH", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Manila",
	}).format(new Date(value))
}

function formatMoney(centavos: number) {
	return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
		centavos / 100
	)
}

function displayJson(value: unknown) {
	if (value === null || value === undefined) return DASH
	return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

function StatusBadge({ status, label }: { status: string; label?: string }) {
	return <Badge variant={statusVariant(status)}>{label ?? titleCase(status)}</Badge>
}

export function TransactionMonitor() {
	const hydrated = useHydrated()
	const locations = useLocationsQuery()
	const categories = useServiceCategoriesQuery()
	const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
	const [page, setPage] = useState(1)
	const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null)
	const [exportError, setExportError] = useState<string | null>(null)
	const detailRef = useRef<HTMLDivElement>(null)

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
		enabled: hydrated,
		queryFn: () =>
			getJson<{ page: number; pageSize: number; total: number; rows: TransactionRow[] }>(
				`${API_BASE}/reports/transactions?${queryString({
					...filterParams,
					page,
					pageSize: PAGE_SIZE,
				})}`
			),
	})

	const detailQuery = useQuery({
		queryKey: ["reports", "transaction", selectedBookingId],
		enabled: hydrated && selectedBookingId !== null,
		queryFn: () =>
			getJson<TransactionDetail>(`${API_BASE}/reports/transactions/${selectedBookingId}`),
	})

	useEffect(() => {
		if (selectedBookingId !== null) {
			detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
		}
	}, [selectedBookingId])

	function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
		setFilters(current => ({ ...current, [key]: value }))
		setPage(1)
	}

	function clearFilters() {
		setFilters(EMPTY_FILTERS)
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

	const total = hydrated ? (listQuery.data?.total ?? 0) : 0
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
	const hasFilters = Object.values(filters).some(value => value !== "")
	const locationOptions = hydrated ? (locations.data ?? []) : []
	const categoryOptions = hydrated ? (categories.data ?? []) : []

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
					<div className="space-y-1">
						<CardTitle>Transaction monitor</CardTitle>
						<CardDescription>
							Search Bookings and review their Payments, Documents, and audit timeline. Times are in
							Asia/Manila.
						</CardDescription>
					</div>
					<div className="flex gap-2">
						<Button type="button" variant="outline" size="sm" onClick={() => void download("csv")}>
							Export CSV
						</Button>
						<Button type="button" variant="outline" size="sm" onClick={() => void download("pdf")}>
							Export PDF
						</Button>
					</div>
				</CardHeader>

				<CardContent className="space-y-4">
					{exportError ? (
						<p className="text-destructive text-sm" role="alert">
							{exportError}
						</p>
					) : null}

					<div className="bg-muted/30 space-y-3 rounded-lg border p-3">
						<input
							className={FIELD}
							placeholder="Search reference, client name or email, or receipt number"
							aria-label="Search"
							maxLength={100}
							value={filters.search}
							onChange={event => updateFilter("search", event.target.value)}
						/>

						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<label className={LABEL}>
								Status
								<select
									className={FIELD}
									value={filters.status}
									onChange={event => updateFilter("status", event.target.value)}
								>
									<option value="">All statuses</option>
									<optgroup label="Booking">
										{BOOKING_STATUSES.map(status => (
											<option key={status} value={status}>
												{bookingLabel(status)}
											</option>
										))}
									</optgroup>
									<optgroup label="Payment">
										{PAYMENT_STATUSES.map(status => (
											<option key={`payment-${status}`} value={status}>
												{titleCase(status)}
											</option>
										))}
									</optgroup>
								</select>
							</label>
							<label className={LABEL}>
								Location
								<select
									className={FIELD}
									value={filters.locationId}
									onChange={event => updateFilter("locationId", event.target.value)}
								>
									<option value="">All locations</option>
									{locationOptions.map(location => (
										<option key={location.id} value={String(location.id)}>
											{location.name}
										</option>
									))}
								</select>
							</label>
							<label className={LABEL}>
								Service Category
								<select
									className={FIELD}
									value={filters.serviceCategoryId}
									onChange={event => updateFilter("serviceCategoryId", event.target.value)}
								>
									<option value="">All Service Categories</option>
									{categoryOptions.map(category => (
										<option key={category.id} value={String(category.id)}>
											{category.name}
										</option>
									))}
								</select>
							</label>
							<label className={LABEL}>
								Payment channel
								<input
									className={FIELD}
									placeholder="e.g. onsite"
									value={filters.channel}
									onChange={event => updateFilter("channel", event.target.value)}
								/>
							</label>
							<label className={LABEL}>
								From
								<input
									className={FIELD}
									type="date"
									value={filters.dateFrom}
									onChange={event => updateFilter("dateFrom", event.target.value)}
								/>
							</label>
							<label className={LABEL}>
								To
								<input
									className={FIELD}
									type="date"
									value={filters.dateTo}
									onChange={event => updateFilter("dateTo", event.target.value)}
								/>
							</label>
							<label className={LABEL}>
								Acting user
								<input
									className={FIELD}
									placeholder="Name, email, or ID"
									value={filters.actor}
									onChange={event => updateFilter("actor", event.target.value)}
								/>
							</label>
							<div className="flex items-end">
								<Button
									type="button"
									variant="ghost"
									className="w-full"
									disabled={!hasFilters}
									onClick={clearFilters}
								>
									Clear filters
								</Button>
							</div>
						</div>
					</div>

					{!hydrated || listQuery.isLoading ? (
						<p className="text-muted-foreground text-sm">Loading transactions...</p>
					) : null}
					{listQuery.isError ? (
						<p className="text-destructive text-sm" role="alert">
							{listQuery.error.message}
						</p>
					) : null}

					{hydrated && listQuery.data ? (
						<div className="overflow-x-auto rounded-lg border">
							<table className="w-full text-left text-sm">
								<thead className="bg-muted/50 text-muted-foreground text-xs">
									<tr>
										<th className="px-3 py-2 font-medium">Reference</th>
										<th className="px-3 py-2 font-medium">Client</th>
										<th className="px-3 py-2 font-medium">Status</th>
										<th className="px-3 py-2 font-medium">Latest payment</th>
										<th className="px-3 py-2 text-right font-medium">Total</th>
										<th className="px-3 py-2 font-medium">Created</th>
										<th className="px-3 py-2" />
									</tr>
								</thead>
								<tbody>
									{listQuery.data.rows.map(row => (
										<tr
											key={row.bookingId}
											className={`hover:bg-muted/40 cursor-pointer border-t ${
												row.bookingId === selectedBookingId ? "bg-muted/60" : ""
											}`}
											onClick={() => setSelectedBookingId(row.bookingId)}
										>
											<td className="px-3 py-2 font-medium whitespace-nowrap">
												{row.referenceNumber}
											</td>
											<td className="px-3 py-2">
												<div>{row.clientName}</div>
												<div className="text-muted-foreground text-xs">{row.clientEmail}</div>
											</td>
											<td className="px-3 py-2">
												<StatusBadge status={row.status} label={bookingLabel(row.status)} />
											</td>
											<td className="px-3 py-2">
												{row.latestPaymentStatus ? (
													<>
														<div>{titleCase(row.latestPaymentStatus)}</div>
														{row.latestReceiptNumber ? (
															<div className="text-muted-foreground text-xs">
																{row.latestReceiptNumber}
															</div>
														) : null}
													</>
												) : (
													<span className="text-muted-foreground">{DASH}</span>
												)}
											</td>
											<td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
												{formatMoney(row.totalCentavos)}
											</td>
											<td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
												{formatDate(row.createdAt)}
											</td>
											<td className="px-3 py-2 text-right">
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={event => {
														event.stopPropagation()
														setSelectedBookingId(row.bookingId)
													}}
												>
													View
												</Button>
											</td>
										</tr>
									))}
									{listQuery.data.rows.length === 0 ? (
										<tr>
											<td className="text-muted-foreground px-3 py-6 text-center" colSpan={7}>
												No matching Bookings.
											</td>
										</tr>
									) : null}
								</tbody>
							</table>
						</div>
					) : null}

					<div className="flex items-center justify-between gap-3">
						<p className="text-muted-foreground text-sm">
							{total} Booking{total === 1 ? "" : "s"}
							{DOT}Page {page} of {pageCount}
						</p>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={page <= 1}
								onClick={() => setPage(current => Math.max(1, current - 1))}
							>
								Previous
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
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
				<div ref={detailRef} className="scroll-mt-4">
					<Card>
						<CardHeader className="flex flex-row items-start justify-between gap-3">
							<div className="space-y-1">
								<CardTitle>
									{detailQuery.data?.booking.referenceNumber ?? "Booking details"}
								</CardTitle>
								{detailQuery.data ? (
									<CardDescription>
										{detailQuery.data.booking.clientName}
										{DOT}
										{detailQuery.data.booking.clientEmail}
									</CardDescription>
								) : null}
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setSelectedBookingId(null)}
							>
								Close
							</Button>
						</CardHeader>
						<CardContent>
							{detailQuery.isLoading ? (
								<p className="text-muted-foreground text-sm">Loading Booking details...</p>
							) : null}
							{detailQuery.isError ? (
								<p className="text-destructive text-sm" role="alert">
									{detailQuery.error.message}
								</p>
							) : null}
							{detailQuery.data ? <DetailView detail={detailQuery.data} /> : null}
						</CardContent>
					</Card>
				</div>
			) : null}
		</div>
	)
}

function Section({
	title,
	count,
	children,
}: {
	title: string
	count: number
	children: ReactNode
}) {
	return (
		<section className="space-y-2">
			<h3 className="text-sm font-semibold">
				{title} <span className="text-muted-foreground font-normal">({count})</span>
			</h3>
			{children}
		</section>
	)
}

function Empty({ children }: { children: ReactNode }) {
	return (
		<p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">{children}</p>
	)
}

function DetailView({ detail }: { detail: TransactionDetail }) {
	const { booking } = detail

	return (
		<div className="space-y-6">
			<dl className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-4">
				<div>
					<dt className="text-muted-foreground text-xs">Status</dt>
					<dd className="mt-1">
						<StatusBadge status={booking.status} label={bookingLabel(booking.status)} />
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground text-xs">Total</dt>
					<dd className="mt-1 font-medium tabular-nums">{formatMoney(booking.totalCentavos)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground text-xs">Kind</dt>
					<dd className="mt-1">{titleCase(booking.kind)}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground text-xs">Created</dt>
					<dd className="mt-1">{formatDate(booking.createdAt)}</dd>
				</div>
			</dl>

			<Section title="Booking items" count={detail.items.length}>
				{detail.items.length === 0 ? (
					<Empty>No in-scope Booking items.</Empty>
				) : (
					<ul className="divide-y rounded-lg border">
						{detail.items.map(item => (
							<li
								key={item.id}
								className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm"
							>
								<div>
									<div className="font-medium">{item.serviceName}</div>
									<div className="text-muted-foreground text-xs">
										{item.serviceCategoryName}
										{DOT}
										{item.locationName}
										{DOT}
										{formatDate(item.startsAt)} to {formatDate(item.endsAt)}
									</div>
								</div>
								<div className="flex items-center gap-3">
									<StatusBadge status={item.status} />
									<span className="tabular-nums">{formatMoney(item.feeCentavos)}</span>
								</div>
							</li>
						))}
					</ul>
				)}
			</Section>

			<Section title="Payments" count={detail.payments.length}>
				{detail.payments.length === 0 ? (
					<Empty>No Payments yet.</Empty>
				) : (
					<ul className="divide-y rounded-lg border">
						{detail.payments.map(payment => (
							<li
								key={payment.id}
								className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm"
							>
								<div>
									<div className="font-medium">{payment.receiptNumber ?? "No receipt"}</div>
									<div className="text-muted-foreground text-xs">
										{titleCase(payment.channelCode)}
										{DOT}
										{formatDate(payment.createdAt)}
										{payment.collectedBy ? `${DOT}Collected by ${payment.collectedBy}` : ""}
									</div>
								</div>
								<div className="flex items-center gap-3">
									{payment.needsReview ? <Badge variant="destructive">Needs review</Badge> : null}
									<StatusBadge status={payment.status} />
									<span className="tabular-nums">{formatMoney(payment.amountCentavos)}</span>
								</div>
							</li>
						))}
					</ul>
				)}
			</Section>

			<Section title="Documents" count={detail.documents.length}>
				{detail.documents.length === 0 ? (
					<Empty>No Documents issued.</Empty>
				) : (
					<ul className="divide-y rounded-lg border">
						{detail.documents.map(document => (
							<li
								key={document.id}
								className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm"
							>
								<div>
									<div className="font-medium">{document.documentNumber}</div>
									<div className="text-muted-foreground text-xs">
										{titleCase(document.documentType)}
										{DOT}
										{document.issuingLocation}
										{DOT}Issued {formatDate(document.issuedAt)}
										{document.validUntil ? `${DOT}Valid until ${document.validUntil}` : ""}
									</div>
								</div>
								<StatusBadge status={document.status} />
							</li>
						))}
					</ul>
				)}
			</Section>

			<Section title="Audit timeline" count={detail.timeline.length}>
				{detail.timeline.length === 0 ? (
					<Empty>No audit events recorded.</Empty>
				) : (
					<ol className="border-muted ml-2 space-y-4 border-l pl-4">
						{detail.timeline.map(event => (
							<li key={event.id} className="relative text-sm">
								<span className="bg-primary absolute top-1.5 -left-[21px] size-2.5 rounded-full" />
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-medium">{titleCase(event.action)}</span>
									<StatusBadge
										status={event.outcome === "success" ? "completed" : "failed"}
										label={titleCase(event.outcome)}
									/>
								</div>
								<div className="text-muted-foreground text-xs">
									{formatDate(event.createdAt)}
									{DOT}
									{event.actorEmail ?? event.actorId ?? "System"}
									{event.actorRole ? `${DOT}${event.actorRole}` : ""}
								</div>
								{event.reason ? <p className="mt-1">Reason: {event.reason}</p> : null}
								<details className="mt-1">
									<summary className="text-muted-foreground cursor-pointer text-xs">
										Change details
									</summary>
									<div className="mt-2 grid gap-2 sm:grid-cols-2">
										<pre className="bg-muted/40 overflow-x-auto rounded-md p-2 text-xs whitespace-pre-wrap">
											<span className="text-muted-foreground">Before{"\n"}</span>
											{displayJson(event.oldValue)}
										</pre>
										<pre className="bg-muted/40 overflow-x-auto rounded-md p-2 text-xs whitespace-pre-wrap">
											<span className="text-muted-foreground">After{"\n"}</span>
											{displayJson(event.newValue)}
										</pre>
									</div>
								</details>
							</li>
						))}
					</ol>
				)}
			</Section>
		</div>
	)
}
