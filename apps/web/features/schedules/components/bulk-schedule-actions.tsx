"use client"

import { useState, type FormEvent } from "react"

import type { BlockScheduleDateResponse, BulkUpdateCapacityResponse } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import {
	useBlockScheduleDateMutation,
	useBulkUpdateCapacityMutation,
	useUnblockScheduleDateMutation,
} from "@/features/schedules/api/schedules.hooks"
import { dateLabel } from "@/features/schedules/lib/calendar"

type Period = "day" | "week" | "month"

const PERIOD_LABELS: Record<Period, string> = {
	day: "Day",
	week: "Week",
	month: "Month",
}

/** What the chosen date covers, shown under the date field. */
const PERIOD_HINTS: Record<Period, string> = {
	day: "Only this date.",
	week: "Monday to Sunday of the week with this date.",
	month: "Every date in this date's month.",
}

const selectClassName =
	"border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm focus-visible:ring-[3px]"

const manilaDateTime = new Intl.DateTimeFormat("en-PH", {
	timeZone: "Asia/Manila",
	dateStyle: "medium",
	timeStyle: "short",
})

function slotCount(count: number): string {
	return count === 1 ? "1 slot" : `${count} slots`
}

function ErrorNote({ error }: { error: Error | null }) {
	if (!error) return null
	return (
		<p role="alert" className="text-destructive text-sm">
			{error.message || "Something went wrong. Please try again."}
		</p>
	)
}

/**
 * SCH-2: change the capacity of many slots at once, and block or unblock a
 * whole date, for the service and location chosen on the Schedules page.
 */
export function BulkScheduleActions({
	serviceId,
	locationId,
}: {
	serviceId: number
	locationId: number
}) {
	const bulkMutation = useBulkUpdateCapacityMutation()
	const blockMutation = useBlockScheduleDateMutation()
	const unblockMutation = useUnblockScheduleDateMutation()

	const [period, setPeriod] = useState<Period>("day")
	const [anchorDate, setAnchorDate] = useState("")
	const [capacity, setCapacity] = useState("20")
	const [bulkResult, setBulkResult] = useState<BulkUpdateCapacityResponse | null>(null)

	const [blockDate, setBlockDate] = useState("")
	const [reason, setReason] = useState("")
	const [blockResult, setBlockResult] = useState<BlockScheduleDateResponse | null>(null)
	const [unblockedCount, setUnblockedCount] = useState<number | null>(null)

	const capacityNumber = Number(capacity)
	const capacityValid = Number.isInteger(capacityNumber) && capacityNumber >= 1
	const blockBusy = blockMutation.isPending || unblockMutation.isPending

	async function submitBulk(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!anchorDate || !capacityValid) return
		setBulkResult(null)
		try {
			setBulkResult(
				await bulkMutation.mutateAsync({
					serviceId,
					locationId,
					period,
					anchorDate,
					capacity: capacityNumber,
				})
			)
		} catch {
			// The error is shown under the form.
		}
	}

	async function submitBlock(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!blockDate || !reason.trim()) return
		setBlockResult(null)
		setUnblockedCount(null)
		unblockMutation.reset()
		try {
			setBlockResult(
				await blockMutation.mutateAsync({
					serviceId,
					locationId,
					date: blockDate,
					reason: reason.trim(),
				})
			)
		} catch {
			// The error is shown under the form.
		}
	}

	async function unblock() {
		if (!blockDate) return
		setBlockResult(null)
		setUnblockedCount(null)
		blockMutation.reset()
		try {
			const result = await unblockMutation.mutateAsync({ serviceId, locationId, date: blockDate })
			setUnblockedCount(result.enabledCount)
		} catch {
			// The error is shown under the form.
		}
	}

	return (
		<section className="grid gap-4 lg:grid-cols-2" aria-label="Bulk schedule actions">
			<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
				<div>
					<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
					<h2 className="text-lg font-bold tracking-tight">Bulk capacity</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Set one capacity for every slot in a day, week or month. A slot that already has more
						bookings than the new capacity stays as it is.
					</p>
				</div>

				<form
					className="grid gap-3 sm:grid-cols-3"
					onSubmit={event => void submitBulk(event)}
					aria-label="Bulk capacity"
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="bulk-period">Period</Label>
						<select
							id="bulk-period"
							className={selectClassName}
							value={period}
							onChange={event => setPeriod(event.target.value as Period)}
							disabled={bulkMutation.isPending}
						>
							{(Object.keys(PERIOD_LABELS) as Period[]).map(value => (
								<option key={value} value={value}>
									{PERIOD_LABELS[value]}
								</option>
							))}
						</select>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="bulk-anchor-date">{period === "day" ? "Date" : "Any date in it"}</Label>
						<Input
							id="bulk-anchor-date"
							type="date"
							required
							value={anchorDate}
							onChange={event => setAnchorDate(event.target.value)}
							disabled={bulkMutation.isPending}
							aria-describedby="bulk-period-hint"
						/>
						<p id="bulk-period-hint" className="text-muted-foreground text-xs">
							{PERIOD_HINTS[period]}
						</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="bulk-capacity">New capacity</Label>
						<Input
							id="bulk-capacity"
							type="number"
							inputMode="numeric"
							min={1}
							max={10000}
							step={1}
							required
							value={capacity}
							onChange={event => setCapacity(event.target.value)}
							disabled={bulkMutation.isPending}
						/>
					</div>
					<Button
						type="submit"
						className="w-full sm:col-span-3 sm:w-auto sm:justify-self-start"
						disabled={bulkMutation.isPending || !anchorDate || !capacityValid}
					>
						{bulkMutation.isPending ? "Updating…" : "Update capacity"}
					</Button>
				</form>

				<ErrorNote error={bulkMutation.error} />

				{bulkResult ? (
					<div className="bg-muted/40 flex flex-col gap-2 rounded-lg p-3 text-sm" role="status">
						<p>
							Updated {bulkResult.updatedCount} of {slotCount(bulkResult.selectedCount)}.
						</p>
						{bulkResult.skipped.length > 0 ? (
							<div>
								<p className="font-medium">
									Not changed, because they already have more bookings than {capacityNumber}:
								</p>
								<ul className="mt-1 list-inside list-disc">
									{bulkResult.skipped.map(slot => (
										<li key={slot.id}>
											{manilaDateTime.format(slot.startsAt)}: {slot.bookedCount} booked, capacity{" "}
											{slot.capacity}
										</li>
									))}
								</ul>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
				<div>
					<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
					<h2 className="text-lg font-bold tracking-tight">Block or unblock a date</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Blocking disables every slot on that date for this service and location, so clients
						cannot book it. Paid bookings are listed for follow-up and are not cancelled.
					</p>
				</div>

				<form
					className="flex flex-col gap-3"
					onSubmit={event => void submitBlock(event)}
					aria-label="Block or unblock a date"
				>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="block-date">Date</Label>
							<Input
								id="block-date"
								type="date"
								required
								value={blockDate}
								onChange={event => setBlockDate(event.target.value)}
								disabled={blockBusy}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="block-reason">Reason (needed to block)</Label>
							<Input
								id="block-reason"
								type="text"
								maxLength={500}
								value={reason}
								onChange={event => setReason(event.target.value)}
								placeholder="For example, public holiday"
								disabled={blockBusy}
							/>
						</div>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Button
							type="submit"
							className="w-full sm:w-auto"
							disabled={blockBusy || !blockDate || !reason.trim()}
						>
							{blockMutation.isPending ? "Blocking…" : "Block date"}
						</Button>
						<Button
							type="button"
							variant="outline"
							className="w-full sm:w-auto"
							disabled={blockBusy || !blockDate}
							onClick={() => void unblock()}
						>
							{unblockMutation.isPending ? "Unblocking…" : "Unblock date"}
						</Button>
					</div>
				</form>

				<ErrorNote error={blockMutation.error} />
				<ErrorNote error={unblockMutation.error} />

				{blockResult ? (
					<div className="bg-muted/40 flex flex-col gap-2 rounded-lg p-3 text-sm" role="status">
						<p>
							Blocked {slotCount(blockResult.disabledCount)} on {dateLabel(blockDate)}.
						</p>
						{blockResult.paidBookings.length > 0 ? (
							<div>
								<p className="font-medium">Paid bookings to follow up (not cancelled):</p>
								<ul className="mt-1 list-inside list-disc">
									{blockResult.paidBookings.map(booking => (
										<li key={booking.referenceNumber}>
											<span className="font-mono">{booking.referenceNumber}</span>,{" "}
											{manilaDateTime.format(booking.startsAt)}
										</li>
									))}
								</ul>
							</div>
						) : (
							<p>No paid bookings on this date.</p>
						)}
					</div>
				) : null}

				{unblockedCount !== null ? (
					<p className="bg-muted/40 rounded-lg p-3 text-sm" role="status">
						Re-enabled {slotCount(unblockedCount)} on {dateLabel(blockDate)}. Slots disabled by hand
						stay disabled.
					</p>
				) : null}
			</div>
		</section>
	)
}
