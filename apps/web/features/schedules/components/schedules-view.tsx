"use client"

import { useMemo, useState } from "react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { ScheduleSlot } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Button } from "@/core/components/ui/button"
import { Label } from "@/core/components/ui/label"
import { useAvailableLocationsQuery } from "@/features/locations/api/locations.hooks"
import { useScheduleSlotsQuery } from "@/features/schedules/api/schedules.hooks"
import { GenerateSlotsDialog } from "@/features/schedules/components/generate-slots-dialog"
import { SlotDialog } from "@/features/schedules/components/slot-dialog"
import {
	groupSlotsByDate,
	manilaDateKey,
	manilaMonthOf,
	monthGrid,
	monthLabel,
	shiftMonth,
	slotTimeRange,
	WEEKDAY_LABELS,
} from "@/features/schedules/lib/calendar"
import { useAvailableServicesQuery } from "@/features/services/api/services.hooks"

const selectClassName =
	"border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm focus-visible:ring-[3px]"

function slotButtonClassName(slot: ScheduleSlot): string {
	const base =
		"focus-visible:ring-ring/50 w-full rounded-md border px-2 py-1 text-left text-xs outline-none transition-colors focus-visible:ring-[3px]"
	if (slot.isDisabled) {
		return `${base} border-border bg-muted text-muted-foreground hover:bg-muted/70`
	}
	if (slot.bookedCount >= slot.capacity) {
		return `${base} border-destructive/30 bg-destructive/5 hover:bg-destructive/10`
	}
	return `${base} border-border hover:bg-muted/60`
}

function slotStatus(slot: ScheduleSlot): string {
	if (slot.isDisabled) return "Disabled"
	if (slot.bookedCount >= slot.capacity) return "Full"
	return "Open"
}

/**
 * Admin calendar for Schedule Slots (SCH-1): pick a service and a location,
 * see the month's slots, generate new ones, and edit, disable or delete a slot.
 */
export function SchedulesView() {
	const services = useAvailableServicesQuery()
	const locations = useAvailableLocationsQuery()

	const [chosenServiceId, setChosenServiceId] = useState<number | null>(null)
	const [chosenLocationId, setChosenLocationId] = useState<number | null>(null)
	const [month, setMonth] = useState(() => manilaMonthOf(new Date()))
	const [generateOpen, setGenerateOpen] = useState(false)
	const [selectedSlot, setSelectedSlot] = useState<ScheduleSlot | null>(null)

	// Until the admin chooses, show the first service and location.
	const serviceId = chosenServiceId ?? services.data?.[0]?.id ?? null
	const locationId = chosenLocationId ?? locations.data?.[0]?.id ?? null
	const service = services.data?.find(item => item.id === serviceId)
	const location = locations.data?.find(item => item.id === locationId)

	const slots = useScheduleSlotsQuery({ serviceId, locationId, month })
	const slotsByDate = useMemo(() => groupSlotsByDate(slots.data ?? []), [slots.data])
	const weeks = useMemo(() => monthGrid(month), [month])
	const today = manilaDateKey(new Date())

	const isLoadingPickers = services.isPending || locations.isPending
	const pickerError = services.error ?? locations.error
	const hasNothingToSchedule =
		!isLoadingPickers && !pickerError && (serviceId === null || locationId === null)

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				title="Schedules"
				description="Set the dates, times and capacity clients can book for a service at a location."
				actions={
					<Button
						type="button"
						onClick={() => setGenerateOpen(true)}
						disabled={serviceId === null || locationId === null}
					>
						<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
						Generate slots
					</Button>
				}
			/>

			{isLoadingPickers ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading services and locations…
				</p>
			) : pickerError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load services and locations.</p>
					<p className="text-muted-foreground mt-1 text-sm">{pickerError.message}</p>
					<Button
						className="mt-3"
						variant="outline"
						onClick={() => {
							void services.refetch()
							void locations.refetch()
						}}
					>
						Retry
					</Button>
				</div>
			) : hasNothingToSchedule ? (
				<div className="border-border rounded-lg border border-dashed p-8 text-center">
					<p className="font-medium">Add a service and a location first.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						Slots are created for an active service at an active location.
					</p>
				</div>
			) : (
				<>
					<div className="flex flex-wrap items-end gap-4">
						<div className="grid gap-2">
							<Label htmlFor="schedule-service">Service</Label>
							<select
								id="schedule-service"
								className={selectClassName}
								value={serviceId ?? ""}
								onChange={event => setChosenServiceId(Number(event.target.value))}
							>
								{services.data?.map(item => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
							</select>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="schedule-location">Location</Label>
							<select
								id="schedule-location"
								className={selectClassName}
								value={locationId ?? ""}
								onChange={event => setChosenLocationId(Number(event.target.value))}
							>
								{locations.data?.map(item => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
							</select>
						</div>

						<div className="ml-auto flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setMonth(current => shiftMonth(current, -1))}
							>
								Previous
							</Button>
							<p className="min-w-36 text-center text-sm font-medium" aria-live="polite">
								{monthLabel(month)}
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setMonth(current => shiftMonth(current, 1))}
							>
								Next
							</Button>
						</div>
					</div>

					{slots.isError ? (
						<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
							<p className="text-sm font-medium">Could not load the schedule.</p>
							<p className="text-muted-foreground mt-1 text-sm">{slots.error.message}</p>
							<Button className="mt-3" variant="outline" onClick={() => void slots.refetch()}>
								Retry
							</Button>
						</div>
					) : (
						<div className="border-border overflow-x-auto rounded-lg border">
							<table className="w-full min-w-[56rem] table-fixed border-collapse">
								<caption className="sr-only">
									Schedule slots for {monthLabel(month)}, shown in Philippine time
								</caption>
								<thead>
									<tr>
										{WEEKDAY_LABELS.map(label => (
											<th
												key={label}
												scope="col"
												className="border-border text-muted-foreground border-b px-2 py-2 text-left text-xs font-medium"
											>
												{label}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{weeks.map((week, weekIndex) => (
										<tr key={weekIndex}>
											{week.map((cell, cellIndex) => {
												const daySlots = cell ? (slotsByDate.get(cell.date) ?? []) : []
												return (
													<td
														key={cell?.date ?? `empty-${weekIndex}-${cellIndex}`}
														className="border-border h-28 border-t border-l p-1.5 align-top first:border-l-0"
													>
														{cell ? (
															<div className="flex flex-col gap-1">
																<span
																	className={
																		cell.date === today
																			? "bg-primary text-primary-foreground inline-flex size-6 items-center justify-center rounded-full text-xs font-medium"
																			: "text-muted-foreground inline-flex size-6 items-center justify-center text-xs"
																	}
																>
																	{cell.day}
																</span>
																{daySlots.map(slot => (
																	<button
																		key={slot.id}
																		type="button"
																		className={slotButtonClassName(slot)}
																		onClick={() => setSelectedSlot(slot)}
																		aria-label={`${slotTimeRange(slot)}, ${slot.bookedCount} of ${slot.capacity} booked, ${slotStatus(slot)}. Edit slot`}
																	>
																		<span className="block font-medium">{slotTimeRange(slot)}</span>
																		<span className="block">
																			{slot.bookedCount}/{slot.capacity} booked
																			{slotStatus(slot) === "Open" ? "" : ` · ${slotStatus(slot)}`}
																		</span>
																	</button>
																))}
															</div>
														) : null}
													</td>
												)
											})}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{slots.isPending ? (
						<p className="text-muted-foreground text-sm" role="status">
							Loading slots…
						</p>
					) : slots.data?.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							No slots this month. Choose Generate slots to add some.
						</p>
					) : null}
				</>
			)}

			{serviceId !== null && locationId !== null ? (
				<GenerateSlotsDialog
					open={generateOpen}
					onOpenChange={setGenerateOpen}
					serviceId={serviceId}
					locationId={locationId}
					serviceName={service?.name ?? "this service"}
					locationName={location?.name ?? "this location"}
				/>
			) : null}

			{selectedSlot ? (
				<SlotDialog
					key={selectedSlot.id}
					slot={selectedSlot}
					onClose={() => setSelectedSlot(null)}
				/>
			) : null}
		</section>
	)
}
