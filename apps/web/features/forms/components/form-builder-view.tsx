"use client"

import { useState } from "react"
import Link from "next/link"
import {
	ArrowDown01Icon,
	ArrowLeft01Icon,
	ArrowUp01Icon,
	Delete02Icon,
	File01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import { FORM_FIELD_TYPES, type FormTemplate, type FormTemplateSummary } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/core/components/ui/empty"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import { Textarea } from "@/core/components/ui/textarea"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import { cn } from "@/core/lib/utils"
import {
	useCreateDraftMutation,
	useDeleteTemplateMutation,
	useFormServicesQuery,
	useFormTemplateQuery,
	useFormVersionsQuery,
	usePublishMutation,
	useSaveFieldsMutation,
	useSetActiveMutation,
} from "@/features/forms/api/forms.hooks"
import {
	blankField,
	FIELD_TYPE_LABELS,
	isChoiceType,
	isDirty,
	moveField,
	parseOptions,
	toDraftFields,
	validateFields,
	type DraftField,
} from "@/features/forms/lib/form-builder"

function errorMessage(caught: unknown, fallback: string): string {
	return caught instanceof Error ? caught.message : fallback
}

const STATUS_LABELS: Record<FormTemplateSummary["status"], string> = {
	draft: "Draft",
	published: "Published",
	retired: "Retired",
}

/**
 * FRM-1 builder for one Service: the versions on the left, the questions of
 * the chosen version with a live preview on the right.
 */
export function FormBuilderView({ serviceId }: { serviceId: number }) {
	const hydrated = useHydrated()
	const services = useFormServicesQuery()
	const versions = useFormVersionsQuery(serviceId)
	const [chosenId, setChosenId] = useState<number | null>(null)

	const service = services.data?.find(row => row.serviceId === serviceId)
	const list = versions.data ?? []
	const fallbackId =
		list.find(row => row.status === "draft")?.id ??
		list.find(row => row.status === "published")?.id ??
		list[0]?.id ??
		null
	const selectedId =
		chosenId !== null && list.some(row => row.id === chosenId) ? chosenId : fallbackId
	const template = useFormTemplateQuery(selectedId)
	const createDraft = useCreateDraftMutation()

	const forbidden = versions.error instanceof ApiError && versions.error.status === 403
	const missing = versions.error instanceof ApiError && versions.error.status === 404

	async function startDraft() {
		try {
			const draft = await createDraft.mutateAsync(serviceId)
			setChosenId(draft.id)
			toast.success(`Draft version ${draft.version} ready`)
		} catch (caught) {
			toast.error(errorMessage(caught, "Could not start a draft"))
		}
	}

	return (
		<section className="flex w-full flex-col gap-6">
			<Link
				href="/forms"
				className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
			>
				<HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} data-icon="inline-start" />
				All forms
			</Link>
			<PageHeader
				icon={File01Icon}
				title={service ? `${service.serviceName} form` : "Service form"}
				description="Add questions, save the draft, then publish it. Publishing retires the previous version but keeps it, so earlier answers still show against their own questions."
			/>

			{forbidden ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<HugeiconsIcon icon={File01Icon} strokeWidth={2} />
						</EmptyMedia>
						<EmptyTitle>You do not have access to forms</EmptyTitle>
						<EmptyDescription>
							Building questionnaires needs the forms.templates:manage permission. This attempt has
							been recorded.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : missing ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>Service not found</EmptyTitle>
						<EmptyDescription>
							It may have been removed, or it is outside your scope.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : !hydrated || versions.isPending ? (
				<div
					className="grid gap-4 lg:grid-cols-[18rem_1fr]"
					role="status"
					aria-label="Loading form"
				>
					<Skeleton className="h-64 w-full rounded-xl" />
					<Skeleton className="h-96 w-full rounded-xl" />
				</div>
			) : versions.isError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load this form.</p>
					<p className="text-muted-foreground mt-1 text-sm">{versions.error.message}</p>
					<Button className="mt-3" variant="outline" onClick={() => void versions.refetch()}>
						Retry
					</Button>
				</div>
			) : list.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>No questionnaire yet</EmptyTitle>
						<EmptyDescription>
							Start a draft and add the questions clients answer for this service.
						</EmptyDescription>
					</EmptyHeader>
					<Button onClick={() => void startDraft()} disabled={createDraft.isPending}>
						{createDraft.isPending ? "Starting…" : "Start draft"}
					</Button>
				</Empty>
			) : (
				<div className="grid items-start gap-4 lg:grid-cols-[18rem_1fr]">
					<VersionList
						versions={list}
						selectedId={selectedId}
						onSelect={setChosenId}
						hasDraft={list.some(row => row.status === "draft")}
						onStartDraft={() => void startDraft()}
						starting={createDraft.isPending}
					/>
					{template.isPending ? (
						<Skeleton className="h-96 w-full rounded-xl" />
					) : template.isError ? (
						<p className="text-destructive text-sm">{template.error.message}</p>
					) : (
						<FieldEditor
							// A new or re-saved version starts the editor from what is stored.
							key={`${template.data.id}:${String(template.data.updatedAt)}`}
							template={template.data}
							hasOtherDraft={list.some(
								row => row.status === "draft" && row.id !== template.data.id
							)}
							onSaved={saved => setChosenId(saved.id)}
						/>
					)}
				</div>
			)}
		</section>
	)
}

function VersionList({
	versions,
	selectedId,
	onSelect,
	hasDraft,
	onStartDraft,
	starting,
}: {
	versions: FormTemplateSummary[]
	selectedId: number | null
	onSelect: (id: number) => void
	hasDraft: boolean
	onStartDraft: () => void
	starting: boolean
}) {
	return (
		<aside className="bg-card flex flex-col gap-3 rounded-xl border p-4" aria-label="Versions">
			<div className="flex items-center justify-between gap-2">
				<h2 className="font-semibold">Versions</h2>
				{hasDraft ? null : (
					<Button size="sm" variant="outline" onClick={onStartDraft} disabled={starting}>
						{starting ? "Starting…" : "New draft"}
					</Button>
				)}
			</div>
			<ul className="flex flex-col gap-2">
				{versions.map(version => (
					<VersionRow
						key={version.id}
						version={version}
						selected={version.id === selectedId}
						onSelect={() => onSelect(version.id)}
					/>
				))}
			</ul>
		</aside>
	)
}

function VersionRow({
	version,
	selected,
	onSelect,
}: {
	version: FormTemplateSummary
	selected: boolean
	onSelect: () => void
}) {
	const setActive = useSetActiveMutation()
	const remove = useDeleteTemplateMutation()
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [offerDisable, setOfferDisable] = useState<string | null>(null)

	async function toggleActive(isActive: boolean) {
		try {
			await setActive.mutateAsync({ templateId: version.id, isActive })
			setOfferDisable(null)
			toast.success(`Version ${version.version} ${isActive ? "enabled" : "disabled"}`)
		} catch (caught) {
			toast.error(errorMessage(caught, "Could not change this version"))
		}
	}

	async function deleteVersion() {
		try {
			await remove.mutateAsync(version.id)
			toast.success(`Version ${version.version} deleted`)
		} catch (caught) {
			setConfirmDelete(false)
			if (caught instanceof ApiError && caught.status === 409) {
				// It has answers: keep it, and offer to disable it instead (FRM-1 AC 4).
				setOfferDisable(caught.message)
				return
			}
			toast.error(errorMessage(caught, "Could not delete this version"))
		}
	}

	const canToggle = version.status !== "draft"

	return (
		<li
			className={cn(
				"flex flex-col gap-2 rounded-lg border p-3",
				selected ? "border-primary bg-primary/5" : "bg-background"
			)}
		>
			<button
				type="button"
				onClick={onSelect}
				className="flex flex-col items-start gap-1 text-left"
			>
				<span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
					Version {version.version}
					<Badge variant={version.status === "published" ? "default" : "secondary"}>
						{STATUS_LABELS[version.status]}
					</Badge>
					{canToggle && !version.isActive ? <Badge variant="destructive">Disabled</Badge> : null}
				</span>
				<span className="text-muted-foreground text-xs">
					{version.fieldCount} question{version.fieldCount === 1 ? "" : "s"} ·{" "}
					{version.submissionCount} submission{version.submissionCount === 1 ? "" : "s"}
				</span>
			</button>

			{offerDisable ? (
				<div
					className="border-destructive/30 bg-destructive/5 rounded-md border p-2 text-xs"
					role="alert"
				>
					<p>{offerDisable}</p>
					{canToggle && version.isActive ? (
						<Button
							size="xs"
							variant="outline"
							className="mt-2"
							onClick={() => void toggleActive(false)}
							disabled={setActive.isPending}
						>
							Disable instead
						</Button>
					) : null}
				</div>
			) : null}

			<div className="flex flex-wrap gap-2">
				{canToggle ? (
					<Button
						size="xs"
						variant="outline"
						onClick={() => void toggleActive(!version.isActive)}
						disabled={setActive.isPending}
					>
						{version.isActive ? "Disable" : "Enable"}
					</Button>
				) : null}
				{confirmDelete ? (
					<>
						<Button
							size="xs"
							variant="destructive"
							onClick={() => void deleteVersion()}
							disabled={remove.isPending}
						>
							{remove.isPending ? "Deleting…" : "Confirm delete"}
						</Button>
						<Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
							Cancel
						</Button>
					</>
				) : (
					<Button size="xs" variant="ghost" onClick={() => setConfirmDelete(true)}>
						Delete
					</Button>
				)}
			</div>
		</li>
	)
}

function FieldEditor({
	template,
	hasOtherDraft,
	onSaved,
}: {
	template: FormTemplate
	hasOtherDraft: boolean
	onSaved: (saved: FormTemplate) => void
}) {
	const save = useSaveFieldsMutation()
	const publish = usePublishMutation()
	const [fields, setFields] = useState<DraftField[]>(() => toDraftFields(template.fields))
	const [error, setError] = useState<{ message: string; index: number | null } | null>(null)

	const readOnly =
		template.status === "retired" || (template.status === "published" && hasOtherDraft)
	const dirty = isDirty(template.fields, fields)

	function update(index: number, change: Partial<DraftField>) {
		setFields(current => current.map((field, i) => (i === index ? { ...field, ...change } : field)))
		setError(null)
	}

	function changeType(index: number, type: DraftField["type"]) {
		const field = fields[index]
		if (!field) return
		const optionsText =
			isChoiceType(type) && parseOptions(field.optionsText).length === 0
				? "Option 1\nOption 2"
				: field.optionsText
		update(index, { type, optionsText })
	}

	async function saveFields() {
		const result = validateFields(fields)
		if (!result.ok) {
			setError({ message: result.message, index: result.index })
			return
		}
		try {
			const saved = await save.mutateAsync({ templateId: template.id, fields: result.fields })
			onSaved(saved)
			toast.success(
				saved.id === template.id
					? `Draft version ${saved.version} saved`
					: `Saved as draft version ${saved.version}. Publish it to replace version ${template.version}.`
			)
		} catch (caught) {
			setError({ message: errorMessage(caught, "Could not save the questions"), index: null })
		}
	}

	async function publishDraft() {
		try {
			const published = await publish.mutateAsync(template.id)
			onSaved(published)
			toast.success(`Version ${published.version} is now the active form`)
		} catch (caught) {
			setError({ message: errorMessage(caught, "Could not publish"), index: null })
		}
	}

	return (
		<div className="grid items-start gap-4 xl:grid-cols-2">
			<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 className="font-semibold">
						Version {template.version} · {STATUS_LABELS[template.status]}
					</h2>
					<div className="flex gap-2">
						{readOnly ? null : (
							<Button
								size="sm"
								variant="outline"
								onClick={() => void saveFields()}
								disabled={!dirty || save.isPending}
							>
								{save.isPending
									? "Saving…"
									: template.status === "draft"
										? "Save draft"
										: "Save as new version"}
							</Button>
						)}
						{template.status === "draft" ? (
							<Button
								size="sm"
								onClick={() => void publishDraft()}
								disabled={dirty || publish.isPending || template.fields.length === 0}
								title={dirty ? "Save the draft before publishing" : undefined}
							>
								{publish.isPending ? "Publishing…" : "Publish"}
							</Button>
						) : null}
					</div>
				</div>

				{template.status === "published" && !readOnly ? (
					<p className="text-muted-foreground text-xs">
						This version is live. Saving changes creates the next version as a draft; this one and
						its submissions stay as they are.
					</p>
				) : null}
				{template.status === "published" && hasOtherDraft ? (
					<p className="text-muted-foreground text-xs">
						A draft already exists. Edit the draft instead.
					</p>
				) : null}
				{template.status === "retired" ? (
					<p className="text-muted-foreground text-xs">
						Retired versions are kept so earlier submissions still show against their own questions.
					</p>
				) : null}

				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error.message}
					</p>
				) : null}

				<ol className="flex flex-col gap-3">
					{fields.map((field, index) => (
						<li
							key={field.key}
							className={cn(
								"flex flex-col gap-3 rounded-lg border p-3",
								error?.index === index ? "border-destructive" : null
							)}
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-muted-foreground text-xs font-medium">
									Question {index + 1}
								</span>
								{readOnly ? null : (
									<div className="flex gap-1">
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={`Move question ${index + 1} up`}
											disabled={index === 0}
											onClick={() => setFields(current => moveField(current, index, -1))}
										>
											<HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
										</Button>
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={`Move question ${index + 1} down`}
											disabled={index === fields.length - 1}
											onClick={() => setFields(current => moveField(current, index, 1))}
										>
											<HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
										</Button>
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={`Delete question ${index + 1}`}
											onClick={() => {
												setFields(current => current.filter((_, i) => i !== index))
												setError(null)
											}}
										>
											<HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
										</Button>
									</div>
								)}
							</div>

							<div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`${field.key}-label`}>Question</Label>
									<Input
										id={`${field.key}-label`}
										value={field.label}
										maxLength={200}
										disabled={readOnly}
										placeholder="e.g. Full name as shown on passport"
										onChange={event => update(index, { label: event.target.value })}
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`${field.key}-type`}>Type</Label>
									<select
										id={`${field.key}-type`}
										value={field.type}
										disabled={readOnly}
										onChange={event => changeType(index, event.target.value as DraftField["type"])}
										className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
									>
										{FORM_FIELD_TYPES.map(type => (
											<option key={type} value={type}>
												{FIELD_TYPE_LABELS[type]}
											</option>
										))}
									</select>
								</div>
							</div>

							{isChoiceType(field.type) ? (
								<div className="flex flex-col gap-1.5">
									<Label htmlFor={`${field.key}-options`}>Options (one per line)</Label>
									<Textarea
										id={`${field.key}-options`}
										rows={3}
										value={field.optionsText}
										disabled={readOnly}
										onChange={event => update(index, { optionsText: event.target.value })}
									/>
								</div>
							) : null}

							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={field.required}
									disabled={readOnly}
									onChange={event => update(index, { required: event.target.checked })}
									className="accent-primary size-4"
								/>
								Required
							</label>
						</li>
					))}
				</ol>

				{readOnly ? null : (
					<Button
						variant="outline"
						onClick={() => {
							setFields(current => [...current, blankField()])
							setError(null)
						}}
					>
						Add question
					</Button>
				)}
			</div>

			<FormPreview fields={fields} />
		</div>
	)
}

/** How the client will see the questions. Inputs are inert here. */
function FormPreview({ fields }: { fields: DraftField[] }) {
	return (
		<div className="bg-card flex flex-col gap-4 rounded-xl border p-4" aria-label="Preview">
			<div>
				<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
				<h2 className="font-semibold">Preview</h2>
				<p className="text-muted-foreground text-xs">
					What the client sees when booking this service.
				</p>
			</div>
			{fields.length === 0 ? (
				<p className="text-muted-foreground text-sm">Add a question to see it here.</p>
			) : (
				<fieldset disabled className="flex flex-col gap-4">
					{fields.map(field => (
						<PreviewField key={field.key} field={field} />
					))}
				</fieldset>
			)}
		</div>
	)
}

function PreviewField({ field }: { field: DraftField }) {
	const label = (
		<span className="text-sm font-medium">
			{field.label.trim() || "Untitled question"}
			{field.required ? <span className="text-destructive"> *</span> : null}
		</span>
	)
	const options = parseOptions(field.optionsText)

	switch (field.type) {
		case "single_choice":
		case "multiple_choice":
			return (
				<div className="flex flex-col gap-1.5">
					{label}
					{options.map(option => (
						<label key={option} className="flex items-center gap-2 text-sm">
							<input
								type={field.type === "single_choice" ? "radio" : "checkbox"}
								name={field.key}
							/>
							{option}
						</label>
					))}
				</div>
			)
		case "yes_no":
			return (
				<div className="flex flex-col gap-1.5">
					{label}
					<div className="flex gap-4 text-sm">
						<label className="flex items-center gap-2">
							<input type="radio" name={field.key} /> Yes
						</label>
						<label className="flex items-center gap-2">
							<input type="radio" name={field.key} /> No
						</label>
					</div>
				</div>
			)
		default:
			return (
				<label className="flex flex-col gap-1.5">
					{label}
					<Input
						type={
							field.type === "number"
								? "number"
								: field.type === "date"
									? "date"
									: field.type === "file"
										? "file"
										: "text"
						}
					/>
				</label>
			)
	}
}
