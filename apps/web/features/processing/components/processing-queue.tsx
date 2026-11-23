"use client"

import { useRef, useState } from "react"
import type { Route } from "next"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { cn } from "@/core/lib/utils"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	useCheckInMutation,
	useProcessingQueueQuery,
} from "@/features/processing/api/processing.hooks"
import { itemStatusLabel } from "@/features/processing/lib/labels"
import { manilaDateKey, slotTimeRange } from "@/features/schedules/lib/calendar"

/**
 * Processing queue (PRC-1): today's Booking Items at the staff user's
 * Location, and a box to check a client in. A handheld scanner reading the
 * booking's QR code types the Reference Number into the box and presses Enter.
 *
 * Hydration-safe: the server and the client's first render both show the
 * loading line and the generic heading, even when the client already holds a
 * restored copy of the queue.
 */
export function ProcessingQueue() {
	const router = useRouter()
	const [date, setDate] = useState(() => manilaDateKey(new Date()))
	const [referenceNumber, setReferenceNumber] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)

	const queue = useProcessingQueueQuery(date)
	const checkIn = useCheckInMutation()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()

	const loading = !hydrated || isQueryLoading(queue)
	// Nothing from the cache is shown until the page has hydrated.
	const data = loading ? undefined : queue.data
	const location = data?.location
	const items = data?.items ?? []

	async function checkInByReference(value: string) {
		if (!value) return
		try {
			const result = await checkIn.mutateAsync(value)
			setReferenceNumber("")
			const [first] = result.items
			toast.success(`${first?.client.name ?? "Client"} is checked in`)
			if (result.items.length === 1 && first) {
				router.push(`/processing/${first.bookingItemId}` as Route)
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not check the client in")
			inputRef.current?.select()
		}
	}

	function submitCheckIn(event: React.FormEvent) {
		event.preventDefault()
		void checkInByReference(referenceNumber.trim().toUpperCase())
	}

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				title="Processing"
				description={
					location
						? `Clients booked at ${location.name}. Check a client in, then verify and assess.`
						: "Check clients in, verify their information and assess their booking."
				}
			/>

			<form
				onSubmit={submitCheckIn}
				className="bg-card flex flex-wrap items-end gap-3 rounded-xl border p-4"
			>
				<div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
					<Label htmlFor="reference-number">Scan the QR code or enter the Reference Number</Label>
					<Input
						id="reference-number"
						ref={inputRef}
						value={referenceNumber}
						onChange={event => setReferenceNumber(event.target.value)}
						placeholder="QSPS-261117-AB12CD"
						autoComplete="off"
						autoFocus
						className="font-mono uppercase"
					/>
				</div>
				<Button
					type="submit"
					className="w-full sm:w-auto"
					disabled={checkIn.isPending || !referenceNumber.trim()}
				>
					{checkIn.isPending ? "Checking in…" : "Check in"}
				</Button>
			</form>

			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex flex-col gap-2">
					<Label htmlFor="queue-date">Date</Label>
					<Input
						id="queue-date"
						type="date"
						value={date}
						onChange={event => event.target.value && setDate(event.target.value)}
						className="w-44"
					/>
				</div>
				<p className="text-muted-foreground text-sm">{data ? `${items.length} booked` : null}</p>
			</div>

			{loading ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading the queue…
				</p>
			) : queue.error ? (
				<p className="text-destructive text-sm" role="alert">
					{queue.error.message}
				</p>
			) : !location ? (
				<p className="text-muted-foreground rounded-xl border p-6 text-sm">
					Your account is not assigned to a BOQ location yet, so there is no queue to show. Ask an
					administrator to assign you to your station.
				</p>
			) : items.length === 0 ? (
				<p className="text-muted-foreground rounded-xl border p-6 text-sm">
					No clients are booked at {location.name} on this date.
				</p>
			) : (
				// Wide content scrolls inside its own container so the page body
				// never scrolls sideways on a phone.
				<div className="overflow-x-auto rounded-xl border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Time</TableHead>
								<TableHead>Client</TableHead>
								<TableHead>Service</TableHead>
								<TableHead>Reference Number</TableHead>
								<TableHead>Payment</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{items.map(item => (
								<TableRow key={item.bookingItemId}>
									<TableCell className="whitespace-nowrap">{slotTimeRange(item)}</TableCell>
									<TableCell className="font-medium">{item.clientName}</TableCell>
									<TableCell>{item.serviceName}</TableCell>
									<TableCell className="font-mono text-xs">{item.referenceNumber}</TableCell>
									<TableCell>
										<Badge variant={item.paymentStatus === "paid" ? "secondary" : "destructive"}>
											{item.paymentStatus === "paid" ? "Paid" : "Unpaid"}
										</Badge>
									</TableCell>
									<TableCell>{itemStatusLabel(item.status)}</TableCell>
									<TableCell className="text-right">
										{item.status === "booked" ? (
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={checkIn.isPending || item.paymentStatus !== "paid"}
												title={
													item.paymentStatus === "paid"
														? undefined
														: "Payment required before check-in"
												}
												onClick={() => void checkInByReference(item.referenceNumber)}
											>
												Check in
											</Button>
										) : (
											<Link
												href={`/processing/${item.bookingItemId}` as Route}
												className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
											>
												Open
											</Link>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</section>
	)
}
