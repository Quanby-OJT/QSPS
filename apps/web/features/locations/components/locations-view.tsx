"use client"

import { useState } from "react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import { MAX_CARD_OFFSET_MM, type CreateLocationInput, type Location } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/core/components/ui/table"
import { Textarea } from "@/core/components/ui/textarea"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	useCreateLocationMutation,
	useLocationsQuery,
	useSetLocationActiveMutation,
	useUpdateLocationMutation,
} from "@/features/locations/api/locations.hooks"

/** The card print offsets are typed as text, so a half-typed "-" or "1." is allowed. */
type LocationForm = CreateLocationInput & { cardOffsetXMm: string; cardOffsetYMm: string }

const emptyForm: LocationForm = {
	code: "",
	name: "",
	address: "",
	region: "",
	cardOffsetXMm: "0",
	cardOffsetYMm: "0",
}

/** A typed offset in millimetres, or null when it is not a number in range. */
function parseOffset(text: string): number | null {
	const value = Number(text.trim())
	if (text.trim() === "" || !Number.isFinite(value)) return null
	if (Math.abs(value) > MAX_CARD_OFFSET_MM) return null
	return value
}

/** "+1.5 mm" / "-2 mm" / "0 mm". */
function formatOffset(value: number): string {
	return `${value > 0 ? "+" : ""}${value} mm`
}

/**
 * BOQ Locations admin (ADM-5).
 *
 * Hydration-safe: the server and the client's first render both show the
 * loading line, even when the client already holds a restored copy.
 */
export function LocationsView() {
	const locations = useLocationsQuery()
	const createLocation = useCreateLocationMutation()
	const updateLocation = useUpdateLocationMutation()
	const setActive = useSetLocationActiveMutation()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<Location | null>(null)
	const [form, setForm] = useState<LocationForm>(emptyForm)
	const isSaving = createLocation.isPending || updateLocation.isPending

	const loading = !hydrated || isQueryLoading(locations)
	const list = locations.data ?? []

	function startCreate() {
		setEditing(null)
		setForm(emptyForm)
		setDialogOpen(true)
	}

	function startEdit(location: Location) {
		setEditing(location)
		setForm({
			code: location.code,
			name: location.name,
			address: location.address,
			region: location.region,
			cardOffsetXMm: String(location.cardOffsetXMm),
			cardOffsetYMm: String(location.cardOffsetYMm),
		})
		setDialogOpen(true)
	}

	async function saveLocation(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		try {
			if (editing) {
				const cardOffsetXMm = parseOffset(form.cardOffsetXMm)
				const cardOffsetYMm = parseOffset(form.cardOffsetYMm)
				if (cardOffsetXMm === null || cardOffsetYMm === null) {
					toast.error(
						`Card offsets must be numbers between -${MAX_CARD_OFFSET_MM} and ${MAX_CARD_OFFSET_MM} mm`
					)
					return
				}
				await updateLocation.mutateAsync({
					code: editing.code,
					name: form.name,
					address: form.address,
					region: form.region,
					cardOffsetXMm,
					cardOffsetYMm,
				})
				toast.success("Location updated")
			} else {
				await createLocation.mutateAsync({
					code: form.code,
					name: form.name,
					address: form.address,
					region: form.region,
				})
				toast.success("Location added")
			}
			setDialogOpen(false)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save location")
		}
	}

	async function toggleActive(location: Location) {
		try {
			await setActive.mutateAsync({ code: location.code, isActive: !location.isActive })
			toast.success(location.isActive ? "Location disabled" : "Location enabled")
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not change location status")
		}
	}

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				title="BOQ Locations"
				description="Manage the offices available for quarantine and cashiering services."
				actions={
					<Button type="button" onClick={startCreate}>
						<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
						Add location
					</Button>
				}
			/>

			{loading ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading locations…
				</p>
			) : locations.isError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load locations.</p>
					<p className="text-muted-foreground mt-1 text-sm">{locations.error.message}</p>
					<Button className="mt-3" variant="outline" onClick={() => void locations.refetch()}>
						Retry
					</Button>
				</div>
			) : list.length === 0 ? (
				<div className="border-border rounded-lg border border-dashed p-8 text-center">
					<p className="font-medium">No locations have been added.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						Add a BOQ office to make it available in the location picker.
					</p>
				</div>
			) : (
				// Wide content scrolls inside its own container so the page body
				// never scrolls sideways on a phone.
				<div className="border-border overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Code</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Address</TableHead>
								<TableHead>Region</TableHead>
								<TableHead>Card offset</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{list.map(location => (
								<TableRow key={location.code}>
									<TableCell className="font-medium">{location.code}</TableCell>
									<TableCell>{location.name}</TableCell>
									<TableCell className="max-w-72 whitespace-normal">{location.address}</TableCell>
									<TableCell>{location.region}</TableCell>
									<TableCell className="text-muted-foreground text-sm whitespace-nowrap">
										X {formatOffset(location.cardOffsetXMm)} · Y{" "}
										{formatOffset(location.cardOffsetYMm)}
									</TableCell>
									<TableCell>
										<Badge variant={location.isActive ? "default" : "secondary"}>
											{location.isActive ? "Active" : "Disabled"}
										</Badge>
									</TableCell>
									<TableCell>
										<div className="flex justify-end gap-2">
											<Button variant="outline" size="sm" onClick={() => startEdit(location)}>
												Edit
											</Button>
											<Button
												variant={location.isActive ? "secondary" : "outline"}
												size="sm"
												disabled={setActive.isPending}
												onClick={() => void toggleActive(location)}
											>
												{location.isActive ? "Disable" : "Enable"}
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-lg">
					<form className="flex flex-col gap-4" onSubmit={event => void saveLocation(event)}>
						<DialogHeader>
							<DialogTitle>{editing ? "Edit location" : "Add location"}</DialogTitle>
							<DialogDescription>
								{editing
									? "Update the BOQ office details. Existing bookings are not changed."
									: "Enter the code, name, address, and region for this BOQ office."}
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="location-code">Code</Label>
								<Input
									id="location-code"
									value={form.code}
									onChange={event => setForm({ ...form, code: event.target.value })}
									disabled={Boolean(editing)}
									required
									maxLength={32}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="location-name">Name</Label>
								<Input
									id="location-name"
									value={form.name}
									onChange={event => setForm({ ...form, name: event.target.value })}
									required
									maxLength={150}
								/>
							</div>
							<div className="grid gap-2 sm:col-span-2">
								<Label htmlFor="location-address">Address</Label>
								<Textarea
									id="location-address"
									value={form.address}
									onChange={event => setForm({ ...form, address: event.target.value })}
									required
									maxLength={500}
								/>
							</div>
							<div className="grid gap-2 sm:col-span-2">
								<Label htmlFor="location-region">Region</Label>
								<Input
									id="location-region"
									value={form.region}
									onChange={event => setForm({ ...form, region: event.target.value })}
									required
									maxLength={120}
								/>
							</div>
							{editing ? (
								<fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
									<legend className="mb-1 text-sm font-medium">Card print offsets</legend>
									<p className="text-muted-foreground text-xs sm:col-span-2">
										Moves everything printed on the yellow vaccination card at this office, in
										millimetres. Positive X moves right; positive Y moves down. Print a test card,
										measure how far it is off, and enter that here.
									</p>
									<div className="grid gap-2">
										<Label htmlFor="location-offset-x">Horizontal (X, mm)</Label>
										<Input
											id="location-offset-x"
											inputMode="decimal"
											value={form.cardOffsetXMm}
											onChange={event => setForm({ ...form, cardOffsetXMm: event.target.value })}
											required
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="location-offset-y">Vertical (Y, mm)</Label>
										<Input
											id="location-offset-y"
											inputMode="decimal"
											value={form.cardOffsetYMm}
											onChange={event => setForm({ ...form, cardOffsetYMm: event.target.value })}
											required
										/>
									</div>
								</fieldset>
							) : null}
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={isSaving}>
								{isSaving ? "Saving…" : editing ? "Save changes" : "Add location"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</section>
	)
}
