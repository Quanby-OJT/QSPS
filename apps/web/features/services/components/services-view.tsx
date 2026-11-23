"use client"

import { useState } from "react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import { DOCUMENT_TYPES, type CreateServiceInput, type Service } from "@repo/contracts"

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
import { useHydrated } from "@/core/hooks/use-hydrated"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	useCreateServiceMutation,
	useServiceCategoriesQuery,
	useServicesQuery,
	useSetServiceActiveMutation,
	useUpdateServiceMutation,
} from "@/features/services/api/services.hooks"
import { feeInPesos, parseFeeCentavos } from "@/features/services/lib/fee"

type DocumentType = (typeof DOCUMENT_TYPES)[number]

/** Names shown to admins for each document type (CRT-1). */
const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
	"icv-record": "International Certificate of Vaccination",
}

function isDocumentType(value: string | null): value is DocumentType {
	return value !== null && (DOCUMENT_TYPES as readonly string[]).includes(value)
}

function documentTypeLabel(value: string | null): string {
	if (value === null) return "—"
	return isDocumentType(value) ? DOCUMENT_TYPE_LABELS[value] : value
}

type ServiceForm = {
	serviceCategoryId: number | ""
	code: string
	name: string
	fee: string
	requiresApproval: boolean
	documentType: DocumentType | ""
	autoIssue: boolean
}

const emptyForm: ServiceForm = {
	serviceCategoryId: "",
	code: "",
	name: "",
	fee: "",
	requiresApproval: false,
	documentType: "",
	autoIssue: true,
}

/**
 * Service catalog admin (ADM-6).
 *
 * Hydration-safe: the server and the client's first render both show the
 * loading line and a disabled Add button, even when the client already holds
 * restored copies of the services or categories.
 */
export function ServicesView() {
	const categories = useServiceCategoriesQuery()
	const services = useServicesQuery()
	const createService = useCreateServiceMutation()
	const updateService = useUpdateServiceMutation()
	const setActive = useSetServiceActiveMutation()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()

	const [dialogOpen, setDialogOpen] = useState(false)
	const [editing, setEditing] = useState<Service | null>(null)
	const [form, setForm] = useState<ServiceForm>(emptyForm)
	const isSaving = createService.isPending || updateService.isPending

	const loading = !hydrated || isQueryLoading(services) || isQueryLoading(categories)
	const serviceList = loading ? [] : (services.data ?? [])
	const categoryList = loading ? [] : (categories.data ?? [])

	function startCreate() {
		setEditing(null)
		setForm({ ...emptyForm, serviceCategoryId: categoryList[0]?.id ?? "" })
		setDialogOpen(true)
	}

	function startEdit(service: Service) {
		setEditing(service)
		setForm({
			serviceCategoryId: service.serviceCategoryId,
			code: service.code,
			name: service.name,
			fee: feeInPesos(service.feeCentavos),
			requiresApproval: service.requiresApproval,
			// An old free-text value is not a document type QSPS can issue, so it shows as none.
			documentType: isDocumentType(service.documentType) ? service.documentType : "",
			autoIssue: service.autoIssue,
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
			toast.error("Enter a fee in pesos with no more than two decimal places")
			return
		}
		const documentType = form.documentType === "" ? null : form.documentType

		try {
			if (editing) {
				// The code is fixed at creation, so it is not sent on update.
				await updateService.mutateAsync({
					id: editing.id,
					serviceCategoryId: form.serviceCategoryId,
					name: form.name,
					feeCentavos,
					requiresApproval: form.requiresApproval,
					documentType,
					autoIssue: form.autoIssue,
				})
				toast.success("Service updated")
			} else {
				const input: CreateServiceInput = {
					serviceCategoryId: form.serviceCategoryId,
					code: form.code,
					name: form.name,
					feeCentavos,
					requiresApproval: form.requiresApproval,
					documentType,
					autoIssue: form.autoIssue,
				}
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
				description="Manage bookable services, their fees, and approval requirements."
				actions={
					<Button type="button" onClick={startCreate} disabled={categoryList.length === 0}>
						<HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
						Add service
					</Button>
				}
			/>

			{loading ? (
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
			) : serviceList.length === 0 ? (
				<div className="border-border rounded-lg border border-dashed p-8 text-center">
					<p className="font-medium">No services have been added.</p>
					<p className="text-muted-foreground mt-1 text-sm">
						Add a service to make it available in the client catalog.
					</p>
				</div>
			) : (
				// Wide content scrolls inside its own container so the page body
				// never scrolls sideways on a phone.
				<div className="border-border overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Category</TableHead>
								<TableHead>Code</TableHead>
								<TableHead>Service</TableHead>
								<TableHead>Fee</TableHead>
								<TableHead>Approval</TableHead>
								<TableHead>Document</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{serviceList.map(service => (
								<TableRow key={service.id}>
									<TableCell>{service.categoryName}</TableCell>
									<TableCell className="font-mono text-xs">{service.code}</TableCell>
									<TableCell className="font-medium">{service.name}</TableCell>
									<TableCell>₱{feeInPesos(service.feeCentavos)}</TableCell>
									<TableCell>{service.requiresApproval ? "Required" : "Not required"}</TableCell>
									<TableCell>
										{documentTypeLabel(service.documentType)}
										{isDocumentType(service.documentType) && !service.autoIssue ? (
											<span className="text-muted-foreground block text-xs">Not automatic</span>
										) : null}
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
									? "Update the service details and fee. Fee changes apply to new bookings only."
									: "Enter the category, code, name, fee, document, and approval requirement."}
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
									{categoryList.map(category => (
										<option key={category.id} value={category.id}>
											{category.name}
										</option>
									))}
								</select>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="service-code">Service code</Label>
								<Input
									id="service-code"
									value={form.code}
									onChange={event => setForm({ ...form, code: event.target.value })}
									placeholder="YF-VAX"
									maxLength={32}
									required
									disabled={Boolean(editing)}
									aria-describedby="service-code-help"
								/>
								<p id="service-code-help" className="text-muted-foreground text-xs">
									{editing
										? "The code cannot be changed after the service is created."
										: "A short unique code, saved in uppercase."}
								</p>
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

							<div className="grid gap-2">
								<Label htmlFor="service-document-type">Document issued</Label>
								<select
									id="service-document-type"
									className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm focus-visible:ring-[3px]"
									value={form.documentType}
									onChange={event =>
										setForm({
											...form,
											documentType: isDocumentType(event.target.value) ? event.target.value : "",
										})
									}
									aria-describedby="service-document-type-help"
								>
									<option value="">None</option>
									{DOCUMENT_TYPES.map(type => (
										<option key={type} value={type}>
											{DOCUMENT_TYPE_LABELS[type]}
										</option>
									))}
								</select>
								<p id="service-document-type-help" className="text-muted-foreground text-xs">
									The document the client receives once the service is cleared.
								</p>
							</div>

							{form.documentType !== "" ? (
								<label className="flex items-center gap-2 text-sm" htmlFor="service-auto-issue">
									<input
										id="service-auto-issue"
										type="checkbox"
										checked={form.autoIssue}
										onChange={event => setForm({ ...form, autoIssue: event.target.checked })}
										className="accent-primary size-4"
									/>
									Issue the document automatically when cleared
								</label>
							) : null}

							<label className="flex items-center gap-2 text-sm" htmlFor="service-approval">
								<input
									id="service-approval"
									type="checkbox"
									checked={form.requiresApproval}
									onChange={event => setForm({ ...form, requiresApproval: event.target.checked })}
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
