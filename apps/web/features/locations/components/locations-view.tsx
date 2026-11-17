"use client"

import { useState } from "react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import type { CreateLocationInput, Location } from "@repo/contracts"

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
import {
	useCreateLocationMutation,
	useLocationsQuery,
	useSetLocationActiveMutation,
	useUpdateLocationMutation,
} from "@/features/locations/api/locations.hooks"

type LocationForm = CreateLocationInput

const emptyForm: LocationForm = { code: "", name: "", address: "", region: "" }

export function LocationsView() {
	const locations = useLocationsQuery()
	const createLocation = useCreateLocationMutation()
	const updateLocation = useUpdateLocationMutation()
	const setActive = useSetLocationActiveMutation()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<Location | null>(null)
	const [form, setForm] = useState<LocationForm>(emptyForm)
	const isSaving = createLocation.isPending || updateLocation.isPending

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
		})
		setDialogOpen(true)
	}

	async function saveLocation(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		try {
			if (editing) {
				await updateLocation.mutateAsync({
					code: editing.code,
					name: form.name,
					address: form.address,
					region: form.region,
				})
				toast.success("Location updated")
			} else {
				await createLocation.mutateAsync(form)
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

			{locations.isPending ? (
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
			) : locations.data.length === 0 ? (
				<div className="border-border rounded-lg border border-dashed p-8 text-center">
					<p className="font-medium">No locations have been added.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						Add a BOQ office to make it available in the location picker.
					</p>
				</div>
			) : (
				<div className="border-border rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Code</TableHead>
								<TableHead>Name</TableHead>
								<TableHead>Address</TableHead>
								<TableHead>Region</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{locations.data.map(location => (
								<TableRow key={location.code}>
									<TableCell className="font-medium">{location.code}</TableCell>
									<TableCell>{location.name}</TableCell>
									<TableCell className="max-w-72 whitespace-normal">{location.address}</TableCell>
									<TableCell>{location.region}</TableCell>
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
