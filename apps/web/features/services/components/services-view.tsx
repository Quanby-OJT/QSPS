"use client"

import { useState } from "react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import type { CreateServiceInput, Service } from "@repo/contracts"

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
import {
	useCreateServiceMutation,
	useServiceCategoriesQuery,
	useServicesQuery,
	useSetServiceActiveMutation,
	useUpdateServiceMutation,
} from "@/features/services/api/services.hooks"

type ServiceForm = {
	serviceCategoryId: number | ""
	name: string
	fee: string
	requiresHeadApproval: boolean
}

const emptyForm: ServiceForm = {
	serviceCategoryId: "",
	name: "",
	fee: "",
	requiresHeadApproval: false,
}

function parseFeeCentavos(value: string): number | null {
	if (!/^\d+(\.\d{1,2})?$/.test(value)) {
		return null
	}
	const [whole, fraction = ""] = value.split(".")
	const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
	return Number.isSafeInteger(amount) && amount <= 2_147_483_647 ? amount : null
}

function feeInPesos(feeCentavos: number): string {
	return (feeCentavos / 100).toFixed(2)
}

export function ServicesView() {
	const categories = useServiceCategoriesQuery()
	const services = useServicesQuery()
	const createService = useCreateServiceMutation()
	const updateService = useUpdateServiceMutation()
	const setActive = useSetServiceActiveMutation()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<Service | null>(null)
	const [form, setForm] = useState<ServiceForm>(emptyForm)
	const isSaving = createService.isPending || updateService.isPending

	function startCreate() {
		setEditing(null)
		setForm({
			...emptyForm,
			serviceCategoryId: categories.data?.[0]?.id ?? "",
		})
		setDialogOpen(true)
	}

	function startEdit(service: Service) {
		setEditing(service)
		setForm({
			serviceCategoryId: service.serviceCategoryId,
			name: service.name,
			fee: feeInPesos(service.feeCentavos),
			requiresHeadApproval: service.requiresHeadApproval,
		})
		setDialogOpen(true)
	}

	async function saveService(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (form.serviceCategoryId === "") {
			toast.error("Choose a service category")
			return
		}
		const feeCentavos = parseFeeCentavos(form.fee)
		if (feeCentavos === null) {
			toast.error("Enter a fee with no more than two decimal places")
			return
		}

		try {
			const input: CreateServiceInput = {
				serviceCategoryId: form.serviceCategoryId,
				name: form.name,
				feeCentavos,
				requiresHeadApproval: form.requiresHeadApproval,
			}
			if (editing) {
				await updateService.mutateAsync({ id: editing.id, ...input })
				toast.success("Service updated")
			} else {
				await createService.mutateAsync(input)
				toast.success("Service added")
			}
			setDialogOpen(false)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save service")
		}
	}

	async function toggleActive(service: Service) {
		try {
			await setActive.mutateAsync({ id: service.id, isActive: !service.isActive })
			toast.success(service.isActive ? "Service deactivated" : "Service activated")
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not change service status")
		}
	}

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				title="Services"
				description="Manage bookable services, their fees, and head-approval requirements."
				actions={
					<Button type="button" onClick={startCreate} disabled={!categories.data?.length}>
						<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
						Add service
					</Button>
				}
			/>

			{services.isPending || categories.isPending ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading services…
				</p>
			) : services.isError || categories.isError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load the service catalog.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						{services.error?.message ?? categories.error?.message}
					</p>
					<Button
						className="mt-3"
						variant="outline"
						onClick={() => {
							void services.refetch()
							void categories.refetch()
						}}
					>
						Retry
					</Button>
				</div>
			) : services.data.length === 0 ? (
				<div className="border-border rounded-lg border border-dashed p-8 text-center">
					<p className="font-medium">No services have been added.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						Add a service to make it available in the client catalog.
					</p>
				</div>
			) : (
				<div className="border-border rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Category</TableHead>
								<TableHead>Service</TableHead>
								<TableHead>Fee</TableHead>
								<TableHead>Head approval</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{services.data.map(service => (
								<TableRow key={service.id}>
									<TableCell>{service.categoryName}</TableCell>
									<TableCell className="font-medium">{service.name}</TableCell>
									<TableCell>₱{feeInPesos(service.feeCentavos)}</TableCell>
									<TableCell>
										{service.requiresHeadApproval ? "Required" : "Not required"}
									</TableCell>
									<TableCell>
										<Badge variant={service.isActive ? "default" : "secondary"}>
											{service.isActive ? "Active" : "Inactive"}
										</Badge>
									</TableCell>
									<TableCell>
										<div className="flex justify-end gap-2">
											<Button variant="outline" size="sm" onClick={() => startEdit(service)}>
												Edit
											</Button>
											<Button
												variant={service.isActive ? "secondary" : "outline"}
												size="sm"
												disabled={setActive.isPending}
												onClick={() => void toggleActive(service)}
											>
												{service.isActive ? "Deactivate" : "Activate"}
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
					<form className="flex flex-col gap-4" onSubmit={event => void saveService(event)}>
						<DialogHeader>
							<DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle>
							<DialogDescription>
								{editing
									? "Update the service details and fee. Changes apply to new bookings."
									: "Enter the category, name, fee, and head-approval requirement."}
							</DialogDescription>
						</DialogHeader>
						<div className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="service-category">Service category</Label>
								<select
									id="service-category"
									className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm focus-visible:ring-[3px]"
									value={form.serviceCategoryId}
									onChange={event =>
										setForm({
											...form,
											serviceCategoryId: event.target.value ? Number(event.target.value) : "",
										})
									}
									required
								>
									<option value="" disabled>
										Select a category
									</option>
									{categories.data?.map(category => (
										<option key={category.id} value={category.id}>
											{category.name}
										</option>
									))}
								</select>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="service-name">Service name</Label>
								<Input
									id="service-name"
									value={form.name}
									onChange={event => setForm({ ...form, name: event.target.value })}
									required
									maxLength={150}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="service-fee">Fee (PHP)</Label>
								<Input
									id="service-fee"
									type="number"
									inputMode="decimal"
									min="0"
									step="0.01"
									value={form.fee}
									onChange={event => setForm({ ...form, fee: event.target.value })}
									required
								/>
							</div>
							<label className="flex items-center gap-2 text-sm" htmlFor="service-approval">
								<input
									id="service-approval"
									type="checkbox"
									checked={form.requiresHeadApproval}
									onChange={event =>
										setForm({ ...form, requiresHeadApproval: event.target.checked })
									}
									className="accent-primary size-4"
								/>
								Requires head approval
							</label>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={isSaving}>
								{isSaving ? "Saving…" : editing ? "Save changes" : "Add service"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</section>
	)
}
