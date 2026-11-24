"use client"

import { useState } from "react"
import Link from "next/link"
import {
	ArrowDown01Icon,
	ArrowLeft01Icon,
	ArrowUp01Icon,
	Delete02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import {
	FORM_FIELD_TYPES,
	MAX_SERVICE_STEPS,
	SaveServiceStepsSchema,
	type ServiceStep,
	type ServiceStepInput,
} from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Textarea } from "@/core/components/ui/textarea"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import { cn } from "@/core/lib/utils"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	blankField,
	FIELD_TYPE_LABELS,
	isChoiceType,
	moveField,
	parseOptions,
	toDraftFields,
	toFieldInputs,
	type DraftField,
} from "@/features/forms/lib/form-builder"
import {
	useSaveServiceStepsMutation,
	useServiceStepsQuery,
} from "@/features/services/api/services.hooks"

/** Staff upload no files at a station, so step results have no file questions. */
const STEP_FIELD_TYPES = FORM_FIELD_TYPES.filter(type => type !== "file")

/** A step while it is being edited. `key` keeps React rows stable while reordering. */
interface DraftStep {
	key: string
	id: number | null
	name: string
	required: boolean
	fields: DraftField[]
	hasResults: boolean
}

let nextStepKey = 0
function stepKey(): string {
	nextStepKey += 1
	return `step-${nextStepKey}`
}

function toDraftSteps(steps: readonly ServiceStep[]): DraftStep[] {
	return steps.map(step => ({
		key: stepKey(),
		id: step.id,
		name: step.name,
		required: step.required,
		fields: toDraftFields(step.fields),
		hasResults: step.hasResults,
	}))
}

function toStepInputs(steps: readonly DraftStep[]): ServiceStepInput[] {
	return steps.map(step => ({
		id: step.id,
		name: step.name.trim(),
		required: step.required,
		fields: toFieldInputs(step.fields),
	}))
}

function blankStep(): DraftStep {
	return {
		key: stepKey(),
		id: null,
		name: "",
		required: true,
		fields: [{ ...blankField("text"), label: "Result", required: true }],
		hasResults: false,
	}
}

/** The first problem in the list, with the step it is in, using the API's own rules. */
function validate(
	serviceId: number,
	steps: readonly DraftStep[]
): { ok: true; steps: ServiceStepInput[] } | { ok: false; message: string; index: number | null } {
	const parsed = SaveServiceStepsSchema.safeParse({ serviceId, steps: toStepInputs(steps) })
	if (parsed.success) return { ok: true, steps: parsed.data.steps }
	const issue = parsed.error.issues[0]
	const index =
		issue?.path[0] === "steps" && typeof issue.path[1] === "number" ? issue.path[1] : null
	const question =
		issue?.path[2] === "fields" && typeof issue.path[3] === "number" ? issue.path[3] + 1 : null
	const where =
		index === null ? "" : `Step ${index + 1}${question === null ? "" : `, question ${question}`}: `
	return { ok: false, index, message: `${where}${issue?.message ?? "Check the steps"}` }
}

function errorMessage(caught: unknown, fallback: string): string {
	return caught instanceof Error ? caught.message : fallback
}

/**
 * PRC-4: configure the ordered steps a Service's Booking Items pass through
 * (for example Laboratory, X-ray, Physician evaluation), each with the
 * questions staff answer to record its result.
 */
export function ServiceStepsView({ serviceId }: { serviceId: number }) {
	const query = useServiceStepsQuery(serviceId)
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const loading = !hydrated || isQueryLoading(query) || (!query.isError && !query.data)
	const forbidden = query.error instanceof ApiError && query.error.status === 403
	const missing = query.error instanceof ApiError && query.error.status === 404

	return (
		<section className="flex w-full flex-col gap-6">
			<Link
				href="/services"
				className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}
			>
				<HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} data-icon="inline-start" />
				All services
			</Link>
			<PageHeader
				title={hydrated && query.data ? `${query.data.serviceName} steps` : "Service steps"}
				description="The stations each booking of this service passes through, in order, such as Laboratory, X-ray and Physician evaluation. Staff record each step's result on the assessment screen, and an item can be cleared only when every required step is done. Leave the list empty if the service has no steps."
			/>
			{loading ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading…
				</p>
			) : forbidden ? (
				<p className="text-muted-foreground text-sm">
					Configuring steps needs the settings.services:manage permission. This attempt has been
					recorded.
				</p>
			) : missing || !query.data ? (
				<p className="text-muted-foreground text-sm">This service was not found.</p>
			) : (
				// Keyed by what was saved, so the editor starts again from the saved list.
				<StepsEditor
					key={JSON.stringify(query.data.steps.map(step => [step.id, step.formVersion]))}
					serviceId={serviceId}
					saved={query.data.steps}
				/>
			)}
		</section>
	)
}

function StepsEditor({ serviceId, saved }: { serviceId: number; saved: ServiceStep[] }) {
	const save = useSaveServiceStepsMutation(serviceId)
	const [steps, setSteps] = useState<DraftStep[]>(() => toDraftSteps(saved))
	const [error, setError] = useState<{ message: string; index: number | null } | null>(null)
	const dirty =
		JSON.stringify(toStepInputs(steps)) !== JSON.stringify(toStepInputs(toDraftSteps(saved)))

	function updateStep(index: number, change: Partial<DraftStep>) {
		setSteps(current => current.map((step, i) => (i === index ? { ...step, ...change } : step)))
		setError(null)
	}

	function updateField(stepIndex: number, fieldIndex: number, change: Partial<DraftField>) {
		const step = steps[stepIndex]
		if (!step) return
		updateStep(stepIndex, {
			fields: step.fields.map((field, i) => (i === fieldIndex ? { ...field, ...change } : field)),
		})
	}

	async function submit() {
		const result = validate(serviceId, steps)
		if (!result.ok) {
			setError({ message: result.message, index: result.index })
			return
		}
		try {
			await save.mutateAsync({ steps: result.steps })
			toast.success(result.steps.length === 0 ? "Steps turned off for this service" : "Steps saved")
		} catch (caught) {
			setError({ message: errorMessage(caught, "Could not save the steps"), index: null })
		}
	}

	return (
		<div className="flex flex-col gap-4">
			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error.message}
				</p>
			) : null}

			{steps.length === 0 ? (
				<p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
					No steps. Items of this service are assessed and cleared as usual.
				</p>
			) : null}

			<ol className="flex flex-col gap-4">
				{steps.map((step, stepIndex) => (
					<li
						key={step.key}
						className={cn(
							"bg-card flex flex-col gap-4 rounded-xl border p-4",
							error?.index === stepIndex ? "border-destructive" : null
						)}
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="flex items-center gap-2 text-sm font-medium">
								Step {stepIndex + 1}
								{step.hasResults ? <Badge variant="outline">Has results</Badge> : null}
							</span>
							<div className="flex gap-1">
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label={`Move step ${stepIndex + 1} up`}
									disabled={stepIndex === 0}
									onClick={() => setSteps(current => moveField(current, stepIndex, -1))}
								>
									<HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
								</Button>
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label={`Move step ${stepIndex + 1} down`}
									disabled={stepIndex === steps.length - 1}
									onClick={() => setSteps(current => moveField(current, stepIndex, 1))}
								>
									<HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
								</Button>
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label={`Remove step ${stepIndex + 1}`}
									onClick={() => {
										setSteps(current => current.filter((_, i) => i !== stepIndex))
										setError(null)
									}}
								>
									<HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
								</Button>
							</div>
						</div>

						<div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor={`${step.key}-name`}>Step name</Label>
								<Input
									id={`${step.key}-name`}
									value={step.name}
									maxLength={100}
									placeholder="e.g. Laboratory"
									onChange={event => updateStep(stepIndex, { name: event.target.value })}
								/>
							</div>
							<label className="flex h-8 items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={step.required}
									onChange={event => updateStep(stepIndex, { required: event.target.checked })}
									className="accent-primary size-4"
								/>
								Required before clearing
							</label>
						</div>
						{step.hasResults ? (
							<p className="text-muted-foreground text-xs">
								Results were recorded at this step. Removing it only stops using it; its results are
								kept. Changing its questions publishes a new version, and earlier results keep their
								own questions.
							</p>
						) : null}

						<fieldset className="flex flex-col gap-3">
							<legend className="mb-1 text-sm font-medium">Result questions</legend>
							{step.fields.map((field, fieldIndex) => (
								<div key={field.key} className="flex flex-col gap-3 rounded-lg border p-3">
									<div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
										<div className="flex flex-col gap-1.5">
											<Label htmlFor={`${field.key}-label`}>Question {fieldIndex + 1}</Label>
											<Input
												id={`${field.key}-label`}
												value={field.label}
												maxLength={200}
												placeholder="e.g. Chest X-ray findings"
												onChange={event =>
													updateField(stepIndex, fieldIndex, { label: event.target.value })
												}
											/>
										</div>
										<div className="flex flex-col gap-1.5">
											<Label htmlFor={`${field.key}-type`}>Type</Label>
											<select
												id={`${field.key}-type`}
												value={field.type}
												onChange={event => {
													const type = event.target.value as DraftField["type"]
													updateField(stepIndex, fieldIndex, {
														type,
														optionsText:
															isChoiceType(type) && parseOptions(field.optionsText).length === 0
																? "Option 1\nOption 2"
																: field.optionsText,
													})
												}}
												className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
											>
												{STEP_FIELD_TYPES.map(type => (
													<option key={type} value={type}>
														{FIELD_TYPE_LABELS[type]}
													</option>
												))}
											</select>
										</div>
										<div className="flex items-end gap-1">
											<Button
												size="icon-xs"
												variant="ghost"
												aria-label={`Move question ${fieldIndex + 1} of step ${stepIndex + 1} up`}
												disabled={fieldIndex === 0}
												onClick={() =>
													updateStep(stepIndex, { fields: moveField(step.fields, fieldIndex, -1) })
												}
											>
												<HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
											</Button>
											<Button
												size="icon-xs"
												variant="ghost"
												aria-label={`Move question ${fieldIndex + 1} of step ${stepIndex + 1} down`}
												disabled={fieldIndex === step.fields.length - 1}
												onClick={() =>
													updateStep(stepIndex, { fields: moveField(step.fields, fieldIndex, 1) })
												}
											>
												<HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
											</Button>
											<Button
												size="icon-xs"
												variant="ghost"
												aria-label={`Delete question ${fieldIndex + 1} of step ${stepIndex + 1}`}
												onClick={() =>
													updateStep(stepIndex, {
														fields: step.fields.filter((_, i) => i !== fieldIndex),
													})
												}
											>
												<HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
											</Button>
										</div>
									</div>
									{isChoiceType(field.type) ? (
										<div className="flex flex-col gap-1.5">
											<Label htmlFor={`${field.key}-options`}>Options (one per line)</Label>
											<Textarea
												id={`${field.key}-options`}
												rows={3}
												value={field.optionsText}
												onChange={event =>
													updateField(stepIndex, fieldIndex, { optionsText: event.target.value })
												}
											/>
										</div>
									) : null}
									<label className="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											checked={field.required}
											onChange={event =>
												updateField(stepIndex, fieldIndex, { required: event.target.checked })
											}
											className="accent-primary size-4"
										/>
										Required answer
									</label>
								</div>
							))}
							<Button
								variant="outline"
								size="sm"
								className="self-start"
								onClick={() => updateStep(stepIndex, { fields: [...step.fields, blankField()] })}
							>
								Add question
							</Button>
						</fieldset>
					</li>
				))}
			</ol>

			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					disabled={steps.length >= MAX_SERVICE_STEPS}
					onClick={() => {
						setSteps(current => [...current, blankStep()])
						setError(null)
					}}
				>
					Add step
				</Button>
				<Button onClick={() => void submit()} disabled={!dirty || save.isPending}>
					{save.isPending ? "Saving…" : "Save steps"}
				</Button>
			</div>
		</div>
	)
}
