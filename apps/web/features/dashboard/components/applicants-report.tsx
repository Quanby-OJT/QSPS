"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Button } from "@/core/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/core/components/ui/card"
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig,
} from "@/core/components/ui/chart"
import { env } from "@/env"

type Period = "day" | "week" | "month" | "year"

type ReportRow = {
	applicants: number
	collectionsCentavos: number
}

type Report = {
	total: ReportRow
	locations: (ReportRow & {
		locationId: number
		locationName: string
	})[]
	serviceCategories: (ReportRow & {
		serviceCategoryId: number
		serviceCategoryName: string
	})[]
}

const chartConfig = {
	applicants: {
		label: "Applicants",
		color: "#1e3a5f",
	},
} satisfies ChartConfig

const currency = new Intl.NumberFormat("en-PH", {
	style: "currency",
	currency: "PHP",
})

function manilaToday(): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Manila",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date())

	const year = parts.find(part => part.type === "year")?.value
	const month = parts.find(part => part.type === "month")?.value
	const day = parts.find(part => part.type === "day")?.value

	return `${year}-${month}-${day}`
}

function money(centavos: number): string {
	return currency.format(centavos / 100)
}

export function ApplicantsReport({ userKey }: { userKey: string }) {
	const [period, setPeriod] = useState<Period>("day")
	const [date, setDate] = useState(manilaToday)

	const report = useQuery({
		queryKey: ["reports", "dashboard", userKey, period, date],
		enabled: date.length > 0,
		gcTime: 0,
		refetchInterval: 60_000,
		queryFn: async (): Promise<Report> => {
			const params = new URLSearchParams({ period, date })
			const base = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`
			const response = await fetch(`${base}/reports/dashboard?${params.toString()}`, {
				credentials: "include",
				cache: "no-store",
			})

			if (!response.ok) {
				throw new Error(`Could not load the report (${response.status})`)
			}

			return (await response.json()) as Report
		},
	})

	return (
		<Card>
			<CardHeader>
				<CardTitle>Applicants and collections</CardTitle>
				<CardDescription>
					Paid bookings within your assigned scope. Dates use Asia/Manila time.
				</CardDescription>
			</CardHeader>

			<CardContent className="space-y-6">
				<div className="flex flex-wrap items-end gap-3">
					<label className="flex flex-col gap-1 text-sm font-medium">
						Period
						<select
							className="border-input bg-background h-9 rounded-md border px-3"
							value={period}
							onChange={event => setPeriod(event.target.value as Period)}
						>
							<option value="day">Day</option>
							<option value="week">Week</option>
							<option value="month">Month</option>
							<option value="year">Year</option>
						</select>
					</label>

					<label className="flex flex-col gap-1 text-sm font-medium">
						Date
						<input
							className="border-input bg-background h-9 rounded-md border px-3"
							type="date"
							value={date}
							onChange={event => setDate(event.target.value)}
						/>
					</label>

					<Button
						type="button"
						variant="outline"
						disabled={!date || report.isFetching}
						onClick={() => void report.refetch()}
					>
						Refresh
					</Button>
				</div>

				{!date ? <p className="text-sm">Select a date to see the report.</p> : null}

				{date && report.isLoading ? (
					<p className="text-muted-foreground text-sm">Loading report…</p>
				) : null}

				{report.isError ? (
					<p className="text-destructive text-sm" role="alert">
						{report.error.message}
					</p>
				) : null}

				{report.data && !report.isError ? (
					<>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="rounded-lg border p-4">
								<p className="text-muted-foreground text-sm">Total applicants</p>
								<p className="text-2xl font-semibold">{report.data.total.applicants}</p>
							</div>
							<div className="rounded-lg border p-4">
								<p className="text-muted-foreground text-sm">Total collections</p>
								<p className="text-2xl font-semibold">
									{money(report.data.total.collectionsCentavos)}
								</p>
							</div>
						</div>

						{report.data.locations.length > 0 ? (
							<ChartContainer config={chartConfig} className="h-64 w-full">
								<BarChart data={report.data.locations} accessibilityLayer>
									<CartesianGrid vertical={false} />
									<XAxis dataKey="locationName" tickLine={false} axisLine={false} />
									<YAxis allowDecimals={false} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Bar dataKey="applicants" fill="var(--color-applicants)" radius={4} />
								</BarChart>
							</ChartContainer>
						) : (
							<p className="text-muted-foreground text-sm">
								No payments found for this period and scope.
							</p>
						)}

						<ReportTable
							title="By location"
							rows={report.data.locations.map(row => ({
								id: row.locationId,
								name: row.locationName,
								applicants: row.applicants,
								collectionsCentavos: row.collectionsCentavos,
							}))}
						/>

						<ReportTable
							title="By service category"
							rows={report.data.serviceCategories.map(row => ({
								id: row.serviceCategoryId,
								name: row.serviceCategoryName,
								applicants: row.applicants,
								collectionsCentavos: row.collectionsCentavos,
							}))}
						/>

						<p className="text-muted-foreground text-xs">
							A booking with services in multiple locations or categories appears in
							each applicable row and once in the consolidated total.
						</p>
					</>
				) : null}
			</CardContent>
		</Card>
	)
}

function ReportTable({
	title,
	rows,
}: {
	title: string
	rows: (ReportRow & { id: number; name: string })[]
}) {
	return (
		<section className="space-y-2">
			<h3 className="text-sm font-semibold">{title}</h3>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<thead>
						<tr className="border-b">
							<th className="p-2">Name</th>
							<th className="p-2 text-right">Applicants</th>
							<th className="p-2 text-right">Collections</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(row => (
							<tr key={row.id} className="border-b">
								<td className="p-2">{row.name}</td>
								<td className="p-2 text-right">{row.applicants}</td>
								<td className="p-2 text-right">{money(row.collectionsCentavos)}</td>
							</tr>
						))}
						{rows.length === 0 ? (
							<tr>
								<td className="text-muted-foreground p-2" colSpan={3}>
									No results
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</div>
		</section>
	)
}
