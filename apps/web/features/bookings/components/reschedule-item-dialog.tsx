"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import type { Booking, SlotAvailability } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/core/components/ui/dialog"
import { useRescheduleBookingItemMutation } from "@/features/bookings/api/bookings.hooks"
import { slotDetail } from "@/features/bookings/components/booking-fee-lines"
import { useSlotAvailabilityQuery } from "@/features/schedules/api/schedules.hooks"
import {
	dateLabel,
	groupSlotsByDate,
	manilaMonthOf,
	monthLabel,
	shiftMonth,
	slotTimeRange,
} from "@/features/schedules/lib/calendar"

function newIdempotencyKey(): string {
	return crypto.randomUUID()
}

type BookingItemRow = Booking["items"][number]

export interface RescheduleItemDialogProps {
	bookingId: number
	item: BookingItemRow | null
	open: boolean
	onOpenChange: (open: boolean) => void
	onRescheduled?: (updated: Booking) => void
}

/**
 * BKG-5: lets a client pick another open slot for the same Service and Location
 * on a booked item. Out-of-scope service or location changes are not offered.
 */
export function RescheduleItemDialog({
	bookingId,
	item,
	open,
	onOpenChange,
	onRescheduled,
}: RescheduleItemDialogProps) {
	const currentMonth = manilaMonthOf(new Date())
	const [month, setMonth] = useState(() =>
		item ? manilaMonthOf(item.startsAt) : manilaMonthOf(new Date())
	)
	const [selectedSlot, setSelectedSlot] = useState<SlotAvailability | null>(null)
	const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)

	const reschedule = useRescheduleBookingItemMutation()

	const availability = useSlotAvailabilityQuery({
		serviceId: open && item ? item.serviceId : null,
		locationId: open && item ? item.locationId : null,
		month,
	})

	const slotsByDate = useMemo(() => groupSlotsByDate(availability.data ?? []), [availability.data])

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) {
			setSelectedSlot(null)
		} else if (item) {
			setMonth(manilaMonthOf(item.startsAt))
			setSelectedSlot(null)
			setIdempotencyKey(newIdempotencyKey())
		}
		onOpenChange(nextOpen)
	}

	async function handleConfirm() {
		if (!item || !selectedSlot) return
		try {
			const updated = await reschedule.mutateAsync({
				bookingId,
				bookingItemId: item.id,
				scheduleSlotId: selectedSlot.id,
				idempotencyKey,
			})
			toast.success(`Rescheduled ${item.serviceName}`)
			onRescheduled?.(updated)
			handleOpenChange(false)
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not reschedule this item"
			toast.error(message)
			setIdempotencyKey(newIdempotencyKey())
			void availability.refetch()
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Reschedule {item?.serviceName ?? "service"}</DialogTitle>
					<DialogDescription>
						{item
							? `Current slot: ${slotDetail(item.locationName, item)}. Choose another open time at ${item.locationName} (Philippine time).`
							: "Choose a new open time for this service."}
					</DialogDescription>
				</DialogHeader>

				{item ? (
					<div className="flex flex-col gap-3">
						<p className="text-muted-foreground text-xs">
							Reschedules used on this item:{" "}
							<span className="text-foreground font-medium">{item.rescheduleCount}</span>
						</p>

						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={month <= currentMonth || reschedule.isPending}
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
								disabled={reschedule.isPending}
								onClick={() => setMonth(current => shiftMonth(current, 1))}
							>
								Next
							</Button>
						</div>

						{availability.isPending ? (
							<p className="text-muted-foreground text-sm" role="status">
								Loading available times…
							</p>
						) : availability.isError ? (
							<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-3">
								<p className="text-sm font-medium">Could not load available times.</p>
								<p className="text-muted-foreground mt-1 text-xs">{availability.error.message}</p>
								<Button
									type="button"
									size="sm"
									variant="outline"
									className="mt-2"
									onClick={() => void availability.refetch()}
								>
									Retry
								</Button>
							</div>
						) : slotsByDate.size === 0 ? (
							<p className="text-muted-foreground text-sm">
								No schedule has been opened for {monthLabel(month)}. Try another month.
							</p>
						) : (
							<div className="flex flex-col gap-3">
								{[...slotsByDate.entries()].map(([date, daySlots]) => (
									<div key={date} className="border-border rounded-lg border p-3">
										<p className="text-sm font-medium">{dateLabel(date)}</p>
										<div className="mt-2 flex flex-wrap gap-2">
											{daySlots.map(slot => {
												const isCurrent = slot.id === item.scheduleSlotId
												const disabled = !slot.isAvailable || isCurrent || reschedule.isPending
												return (
													<button
														key={slot.id}
														type="button"
														disabled={disabled}
														aria-pressed={slot.id === selectedSlot?.id}
														className="border-border hover:bg-muted/60 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/5 rounded-md border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
														onClick={() => setSelectedSlot(slot)}
													>
														<span className="block font-medium">{slotTimeRange(slot)}</span>
														<span className="text-muted-foreground block text-xs">
															{isCurrent
																? "Current slot"
																: slot.isAvailable
																	? `${slot.remainingCapacity} ${slot.remainingCapacity === 1 ? "place" : "places"} left`
																	: slot.remainingCapacity === 0
																		? "Full"
																		: "Unavailable"}
														</span>
													</button>
												)
											})}
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				) : null}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={reschedule.isPending}
						onClick={() => handleOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={!selectedSlot || reschedule.isPending}
						onClick={() => void handleConfirm()}
					>
						{reschedule.isPending ? "Rescheduling…" : "Confirm reschedule"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}