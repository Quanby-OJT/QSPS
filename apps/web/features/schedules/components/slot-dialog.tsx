"use client"

import { useState } from "react"
import { toast } from "sonner"

import type { ScheduleSlot } from "@repo/contracts"

import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/core/components/ui/dialog"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import {
	useDeleteSlotMutation,
	useSetSlotDisabledMutation,
	useUpdateSlotCapacityMutation,
} from "@/features/schedules/api/schedules.hooks"
import { dateLabel, manilaDateKey, slotTimeRange } from "@/features/schedules/lib/calendar"

interface SlotDialogProps {
	slot: ScheduleSlot
	onClose: () => void
}

/** Edit one slot: change capacity, disable or re-enable it, or delete it. */
export function SlotDialog({ slot, onClose }: SlotDialogProps) {
	const updateCapacity = useUpdateSlotCapacityMutation()
	const setDisabled = useSetSlotDisabledMutation()
	const deleteSlot = useDeleteSlotMutation()

	const [capacity, setCapacity] = useState(String(slot.capacity))
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const isBusy = updateCapacity.isPending || setDisabled.isPending || deleteSlot.isPending
	const hasBookings = slot.bookedCount > 0

	async function saveCapacity(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const value = Number(capacity)
		if (!Number.isInteger(value) || value < 1) {
			toast.error("Enter a whole number of at least 1")
			return
		}
		if (value < slot.bookedCount) {
			toast.error(`Capacity cannot be lower than the ${slot.bookedCount} already booked`)
			return
		}
		try {
			await updateCapacity.mutateAsync({ id: slot.id, capacity: value })
			toast.success("Capacity updated")
			onClose()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not update capacity")
		}
	}

	async function toggleDisabled() {
		try {
			await setDisabled.mutateAsync({ id: slot.id, isDisabled: !slot.isDisabled })
			toast.success(slot.isDisabled ? "Slot enabled" : "Slot disabled")
			onClose()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not change slot status")
		}
	}

	async function removeSlot() {
		try {
			await deleteSlot.mutateAsync(slot.id)
			toast.success("Slot deleted")
			onClose()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not delete slot")
		}
	}

	return (
		<Dialog open onOpenChange={open => (open ? undefined : onClose())}>
			<DialogContent className="sm:max-w-md">
				<form className="flex flex-col gap-4" onSubmit={event => void saveCapacity(event)}>
					<DialogHeader>
						<DialogTitle>{slotTimeRange(slot)}</DialogTitle>
						<DialogDescription>{dateLabel(manilaDateKey(slot.startsAt))}</DialogDescription>
					</DialogHeader>

					<div className="flex flex-wrap items-center gap-2 text-sm">
						<Badge variant={slot.isDisabled ? "secondary" : "default"}>
							{slot.isDisabled ? "Disabled" : "Open"}
						</Badge>
						<span>
							{slot.bookedCount} of {slot.capacity} booked
						</span>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="slot-capacity">Capacity</Label>
						<Input
							id="slot-capacity"
							type="number"
							inputMode="numeric"
							min={Math.max(1, slot.bookedCount)}
							step="1"
							value={capacity}
							onChange={event => setCapacity(event.target.value)}
							required
							aria-describedby="slot-capacity-help"
						/>
						<p id="slot-capacity-help" className="text-muted-foreground text-xs">
							{hasBookings
								? `Cannot go below the ${slot.bookedCount} already booked.`
								: "How many clients this slot can take."}
						</p>
					</div>

					<div className="border-border flex flex-wrap items-center gap-2 border-t pt-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isBusy}
							onClick={() => void toggleDisabled()}
						>
							{slot.isDisabled ? "Enable slot" : "Disable slot"}
						</Button>
						{confirmingDelete ? (
							<>
								<Button
									type="button"
									variant="destructive"
									size="sm"
									disabled={isBusy}
									onClick={() => void removeSlot()}
								>
									Confirm delete
								</Button>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => setConfirmingDelete(false)}
								>
									Keep slot
								</Button>
							</>
						) : (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={isBusy || hasBookings}
								onClick={() => setConfirmingDelete(true)}
							>
								Delete slot
							</Button>
						)}
					</div>
					<p className="text-muted-foreground text-xs">
						{hasBookings
							? "A slot with bookings cannot be deleted. Disable it to stop new bookings; existing bookings stay."
							: "A disabled slot takes no new bookings. Existing bookings stay."}
					</p>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Close
						</Button>
						<Button type="submit" disabled={isBusy}>
							{updateCapacity.isPending ? "Saving…" : "Save capacity"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
