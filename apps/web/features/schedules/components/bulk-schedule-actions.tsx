"use client"

import { useState, type FormEvent } from "react"

import type { BulkUpdateCapacityResponse } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { Label } from "@/core/components/ui/label"
import {
	useBlockScheduleDateMutation,
	useBulkUpdateCapacityMutation,
	useUnblockScheduleDateMutation,
	type BlockScheduleDateResponse,
} from "@/features/schedules/api/schedules.hooks"

const fieldClassName =
	"border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm focus-visible:ring-[3px]"

function formatManila(value: string | Date): string {
	const date = value instanceof Date ? value : new Date(value)
	return new Intl.DateTimeFormat("en-PH", {
		timeZone: "Asia/Manila",
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date)
}

export function BulkScheduleActions({
	serviceId,
	locationId,
}: {
	serviceId: number
	locationId: number
}) {
	const [period, setPeriod] = useState<"day" | "week" | "month">("day")
	const [anchorDate, setAnchorDate] = useState("")
	const [capacity, setCapacity] = useState("20")
	const [bulkResult, setBulkResult] = useState<BulkUpdateCapacityResponse | null>(null)
	const [blockedDate, setBlockedDate] = useState("")
	const [reason, setReason] = useState("")
	const [blockResult, setBlockResult] = useState<BlockScheduleDateResponse | null>(null)
	const bulkMutation = useBulkUpdateCapacityMutation()
	const blockMutation = useBlockScheduleDateMutation()
	const unblockMutation = useUnblockScheduleDateMutation()

	async function submitBulk(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!anchorDate) return
		setBulkResult(null)
		try {
			setBulkResult(
				await bulkMutation.mutateAsync({
					serviceId,
					locationId,
					period,
					anchorDate,
					capacity: Number(capacity),
				})
			)
		} catch {
			// The mutation error is shown below.
		}
	}

	async function submitBlock(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!blockedDate) return
		setBlockResult(null)
		try {
			setBlockResult(await blockMutation.mutateAsync({ serviceId, locationId, date: blockedDate, reason }))
		} catch {
			// The mutation error is shown below.
		}
	}

	async function unblock() {
		if (!blockedDate) return
		try {
			await unblockMutation.mutateAsync({ serviceId, locationId, date: blockedDate })
			setBlockResult(null)
		} catch {
			// The mutation error is shown below.
		}
	}

	return (
		<section className="grid gap-4 lg:grid-cols-2" aria-label="Bulk schedule actions">
			<div className="border-border grid content-start gap-4 rounded-lg border p-4">
				<div>
					<h2 className="font-semibold">Bulk capacity</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Update slots for a day, week, or month. Slots with more bookings than the new capacity stay unchanged.
					</p>
				</div>
				<form className="grid gap-3 sm:grid-cols-3" onSubmit={event => void submitBulk(event)}>
					<div className="grid gap-2">
						<Label htmlFor="bulk-period">Period</Label>
						<select id="bulk-period" className={fieldClassName} value={period} onChange={event => setPeriod(event.target.value as typeof period)}>
							<option value="day">Day</option>
							<option value="week">Week</option>
							<option value="month">Month</option>
						</select>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="bulk-anchor-date">Date</Label>
						<input id="bulk-anchor-date" type="date" required className={fieldClassName} value={anchorDate} onChange={event => setAnchorDate(event.target.value)} />
					</div>
					<div className="grid gap-2">
						<Label htmlFor="bulk-capacity">New capacity</Label>
						<input id="bulk-capacity" type="number" min="1" max="10000" required className={fieldClassName} value={capacity} onChange={event => setCapacity(event.target.value)} />
					</div>
					<Button className="sm:col-span-3" type="submit" disabled={bulkMutation.isPending || !anchorDate}>
						{bulkMutation.isPending ? "Updating…" : "Update capacity"}
					</Button>
				</form>
				{bulkMutation.error ? <p className="text-destructive text-sm" role="alert">{bulkMutation.error.message}</p> : null}
				{bulkResult ? (
					<div className="grid gap-2 text-sm" role="status">
						<p>Updated {bulkResult.updatedCount} of {bulkResult.selectedCount} slots.</p>
						{bulkResult.skipped.length ? (
							<div>
								<p className="font-medium">Unchanged because bookings exceed the new capacity:</p>
								<ul className="mt-1 list-inside list-disc">
									{bulkResult.skipped.map(slot => <li key={slot.id}>{formatManila(slot.startsAt)} — {slot.bookedCount} booked; current capacity {slot.capacity}</li>)}
								</ul>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="border-border grid content-start gap-4 rounded-lg border p-4">
				<div>
					<h2 className="font-semibold">Block or unblock a date</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Blocking disables every slot for this service and location. Paid bookings are listed for follow-up and are not cancelled.
					</p>
				</div>
				<form className="grid gap-3" onSubmit={event => void submitBlock(event)}>
					<div className="grid gap-2 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label htmlFor="blocked-date">Date</Label>
							<input id="blocked-date" type="date" required className={fieldClassName} value={blockedDate} onChange={event => setBlockedDate(event.target.value)} />
						</div>
						<div className="grid gap-2">
							<Label htmlFor="block-reason">Reason</Label>
							<input id="block-reason" type="text" maxLength={500} required className={fieldClassName} value={reason} onChange={event => setReason(event.target.value)} placeholder="For example, public holiday" />
						</div>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button type="submit" disabled={blockMutation.isPending || !blockedDate || !reason.trim()}>
							{blockMutation.isPending ? "Blocking…" : "Block date"}
						</Button>
						<Button type="button" variant="outline" disabled={unblockMutation.isPending || !blockedDate} onClick={() => void unblock()}>
							{unblockMutation.isPending ? "Unblocking…" : "Unblock date"}
						</Button>
					</div>
				</form>
				{blockMutation.error ? <p className="text-destructive text-sm" role="alert">{blockMutation.error.message}</p> : null}
				{unblockMutation.error ? <p className="text-destructive text-sm" role="alert">{unblockMutation.error.message}</p> : null}
				{blockResult ? (
					<div className="grid gap-2 text-sm" role="status">
						<p>Blocked {blockResult.disabledCount} slots for {blockedDate}.</p>
						{blockResult.paidBookings.length ? (
							<div>
								<p className="font-medium">Paid bookings needing follow-up (not cancelled):</p>
								<ul className="mt-1 list-inside list-disc">
									{blockResult.paidBookings.map(booking => <li key={booking.referenceNumber}>{booking.referenceNumber} — {formatManila(booking.startsAt)}</li>)}
								</ul>
							</div>
						) : <p>No paid bookings were found on this date.</p>}
					</div>
				) : null}
			</div>
		</section>
	)
}
