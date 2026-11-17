"use client"

import { useState } from "react"
import { toast } from "sonner"

import { GenerateSlotsSchema, type TimeWindow } from "@repo/contracts"

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
import { useGenerateSlotsMutation } from "@/features/schedules/api/schedules.hooks"
import { manilaDateKey, WEEKDAY_LABELS } from "@/features/schedules/lib/calendar"

interface GenerateSlotsDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	serviceId: number
	locationId: number
	serviceName: string
	locationName: string
}

interface GenerateForm {
	startDate: string
	endDate: string
	weekdays: number[]
	windows: TimeWindow[]
	capacity: string
}

const MAX_WINDOWS = 24

function initialForm(): GenerateForm {
	const today = manilaDateKey(new Date())
	return {
		startDate: today,
		endDate: today,
		// Monday to Friday.
		weekdays: [1, 2, 3, 4, 5],
		windows: [
			{ startTime: "08:00", endTime: "12:00" },
			{ startTime: "13:00", endTime: "17:00" },
		],
		capacity: "20",
	}
}

export function GenerateSlotsDialog({
	open,
	onOpenChange,
	serviceId,
	locationId,
	serviceName,
	locationName,
}: GenerateSlotsDialogProps) {
	const generateSlots = useGenerateSlotsMutation()
	const [form, setForm] = useState<GenerateForm>(initialForm)

	function toggleWeekday(weekday: number) {
		setForm(current => ({
			...current,
			weekdays: current.weekdays.includes(weekday)
				? current.weekdays.filter(day => day !== weekday)
				: [...current.weekdays, weekday].sort((a, b) => a - b),
		}))
	}

	function updateWindow(index: number, change: Partial<TimeWindow>) {
		setForm(current => ({
			...current,
			windows: current.windows.map((window, position) =>
				position === index ? { ...window, ...change } : window
			),
		}))
	}

	function addWindow() {
		setForm(current => ({
			...current,
			windows: [...current.windows, { startTime: "08:00", endTime: "09:00" }],
		}))
	}

	function removeWindow(index: number) {
		setForm(current => ({
			...current,
			windows: current.windows.filter((_, position) => position !== index),
		}))
	}

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		// The same rules the API applies, so mistakes are caught before sending.
		const parsed = GenerateSlotsSchema.safeParse({
			serviceId,
			locationId,
			startDate: form.startDate,
			endDate: form.endDate,
			weekdays: form.weekdays,
			windows: form.windows,
			capacity: Number(form.capacity),
		})
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? "Check the form and try again")
			return
		}

		try {
			const { createdCount, skippedCount } = await generateSlots.mutateAsync(parsed.data)
			const created = createdCount === 1 ? "1 slot created" : `${createdCount} slots created`
			toast.success(
				skippedCount > 0 ? `${created}; ${skippedCount} already existed and were skipped` : created
			)
			onOpenChange(false)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not generate slots")
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<form className="flex flex-col gap-4" onSubmit={event => void submit(event)}>
					<DialogHeader>
						<DialogTitle>Generate slots</DialogTitle>
						<DialogDescription>
							Create slots for {serviceName} at {locationName}. Dates and times are Philippine time.
							Slots that already exist are skipped.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4">
						<div className="grid grid-cols-2 gap-3">
							<div className="grid gap-2">
								<Label htmlFor="generate-start-date">Start date</Label>
								<Input
									id="generate-start-date"
									type="date"
									value={form.startDate}
									onChange={event => setForm({ ...form, startDate: event.target.value })}
									required
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="generate-end-date">End date</Label>
								<Input
									id="generate-end-date"
									type="date"
									value={form.endDate}
									min={form.startDate}
									onChange={event => setForm({ ...form, endDate: event.target.value })}
									required
								/>
							</div>
						</div>

						<fieldset className="grid gap-2">
							<legend className="text-sm font-medium">Days of the week</legend>
							<div className="flex flex-wrap gap-x-4 gap-y-2">
								{WEEKDAY_LABELS.map((label, weekday) => (
									<label
										key={label}
										className="flex items-center gap-2 text-sm"
										htmlFor={`generate-weekday-${weekday}`}
									>
										<input
											id={`generate-weekday-${weekday}`}
											type="checkbox"
											checked={form.weekdays.includes(weekday)}
											onChange={() => toggleWeekday(weekday)}
										/>
										{label}
									</label>
								))}
							</div>
						</fieldset>

						<fieldset className="grid gap-2">
							<legend className="text-sm font-medium">Time windows</legend>
							{form.windows.map((window, index) => (
								<div key={index} className="flex items-center gap-2">
									<Input
										type="time"
										aria-label={`Window ${index + 1} start time`}
										value={window.startTime}
										onChange={event => updateWindow(index, { startTime: event.target.value })}
										required
									/>
									<span className="text-muted-foreground text-sm">to</span>
									<Input
										type="time"
										aria-label={`Window ${index + 1} end time`}
										value={window.endTime}
										onChange={event => updateWindow(index, { endTime: event.target.value })}
										required
									/>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={form.windows.length === 1}
										onClick={() => removeWindow(index)}
									>
										Remove
									</Button>
								</div>
							))}
							<div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={form.windows.length >= MAX_WINDOWS}
									onClick={addWindow}
								>
									Add time window
								</Button>
							</div>
						</fieldset>

						<div className="grid gap-2">
							<Label htmlFor="generate-capacity">Capacity per slot</Label>
							<Input
								id="generate-capacity"
								type="number"
								inputMode="numeric"
								min="1"
								step="1"
								value={form.capacity}
								onChange={event => setForm({ ...form, capacity: event.target.value })}
								required
								aria-describedby="generate-capacity-help"
							/>
							<p id="generate-capacity-help" className="text-muted-foreground text-xs">
								How many clients each slot can take.
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={generateSlots.isPending}>
							{generateSlots.isPending ? "Generating…" : "Generate slots"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
