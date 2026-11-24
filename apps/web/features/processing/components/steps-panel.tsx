"use client"

import { useState } from "react"
import { toast } from "sonner"

import {
	checkFormAnswers,
	type FormAnswerValue,
	type ItemStep,
	type ProcessingItem,
	type StepResult,
} from "@repo/contracts"

import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import { QuestionnaireFields } from "@/features/forms/components/questionnaire-fields"
import {
	stepResultPdfUrl,
	useRecordStepResultMutation,
} from "@/features/processing/api/processing.hooks"
import { pendingRequiredSteps } from "@/features/processing/lib/labels"

function newKey(): string {
	return crypto.randomUUID()
}

/** "Nov 24, 2026, 10:05 AM" in Manila time. */
function recordedAtLabel(value: Date | string): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Manila",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(value))
}

/**
 * PRC-4: the stations this item passes through, each with its status and
 * result. Staff record or correct a result while the item is in assessment;
 * a correction is saved as the next version and the earlier one is kept.
 */
export function StepsPanel({ item, canRecord }: { item: ProcessingItem; canRecord: boolean }) {
	const steps = item.steps ?? []
	const pending = pendingRequiredSteps(steps)
	const requiredCount = steps.filter(step => step.required).length

	return (
		<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold">Steps</h2>
				<p className="text-muted-foreground text-xs">
					{requiredCount === 0
						? "No step is required."
						: pending.length === 0
							? "Every required step is done."
							: `${requiredCount - pending.length} of ${requiredCount} required steps done`}
				</p>
			</div>
			<ol className="flex flex-col gap-3">
				{steps.map((step, index) => (
					<StepRow
						key={step.stepId}
						item={item}
						step={step}
						number={index + 1}
						canRecord={canRecord && step.isActive && step.form !== null}
					/>
				))}
			</ol>
		</div>
	)
}

function StepRow({
	item,
	step,
	number,
	canRecord,
}: {
	item: ProcessingItem
	step: ItemStep
	number: number
	canRecord: boolean
}) {
	const [editing, setEditing] = useState(false)
	const [showHistory, setShowHistory] = useState(false)

	return (
		<li className="flex flex-col gap-3 rounded-lg border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="flex items-center gap-2 font-medium">
					<span className="text-muted-foreground text-xs">{number}.</span>
					{step.name}
				</p>
				<div className="flex flex-wrap gap-1.5">
					{step.isActive ? (
						<Badge variant="outline">{step.required ? "Required" : "Optional"}</Badge>
					) : (
						<Badge variant="outline">No longer used</Badge>
					)}
					<Badge variant={step.status === "done" ? "secondary" : "outline"}>
						{step.status === "done" ? "Done" : "Pending"}
					</Badge>
				</div>
			</div>

			{step.result && !editing ? (
				<ResultView bookingItemId={item.bookingItemId} stepId={step.stepId} result={step.result} />
			) : null}
			{!step.result && !editing ? (
				<p className="text-muted-foreground text-sm">No result recorded yet.</p>
			) : null}

			{editing && step.form ? (
				<ResultForm item={item} step={step} form={step.form} onDone={() => setEditing(false)} />
			) : null}

			{!editing ? (
				<div className="flex flex-wrap gap-2">
					{canRecord ? (
						<Button
							type="button"
							size="sm"
							variant={step.result ? "outline" : "default"}
							onClick={() => setEditing(true)}
						>
							{step.result ? "Correct result" : "Record result"}
						</Button>
					) : null}
					{step.result ? (
						<a
							href={stepResultPdfUrl(item.bookingItemId, step.stepId)}
							target="_blank"
							rel="noopener noreferrer"
							className={buttonVariants({ size: "sm", variant: "outline" })}
						>
							Print result
						</a>
					) : null}
					{step.history.length > 0 ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							aria-expanded={showHistory}
							onClick={() => setShowHistory(current => !current)}
						>
							{showHistory ? "Hide" : "Show"} earlier versions ({step.history.length})
						</Button>
					) : null}
				</div>
			) : null}

			{showHistory && !editing ? (
				<ol className="flex flex-col gap-2 border-l pl-3">
					{step.history.map(result => (
						<li key={result.id} className="flex flex-col gap-2">
							<ResultView
								bookingItemId={item.bookingItemId}
								stepId={step.stepId}
								result={result}
								printable
							/>
						</li>
					))}
				</ol>
			) : null}
		</li>
	)
}

function ResultView({
	bookingItemId,
	stepId,
	result,
	printable = false,
}: {
	bookingItemId: number
	stepId: number
	result: StepResult
	/** Show a print link for this exact version (earlier versions). */
	printable?: boolean
}) {
	const answers = Object.entries(result.answers)
	return (
		<div className="flex flex-col gap-2">
			<dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
				{answers.map(([label, answer]) => (
					<div key={label} className="flex flex-col">
						<dt className="text-muted-foreground text-xs">{label}</dt>
						<dd>{answer}</dd>
					</div>
				))}
			</dl>
			<p className="text-muted-foreground text-xs">
				{result.version > 1 ? `Version ${result.version} (correction) · ` : "Version 1 · "}
				{result.recordedBy.name} · {recordedAtLabel(result.recordedAt)}
				{printable ? (
					<>
						{" · "}
						<a
							href={stepResultPdfUrl(bookingItemId, stepId, result.version)}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2"
						>
							Print this version
						</a>
					</>
				) : null}
			</p>
		</div>
	)
}

function ResultForm({
	item,
	step,
	form,
	onDone,
}: {
	item: ProcessingItem
	step: ItemStep
	form: NonNullable<ItemStep["form"]>
	onDone: () => void
}) {
	const record = useRecordStepResultMutation(item.bookingItemId)
	// A correction starts from the current answers when they were for this form version.
	const [values, setValues] = useState<Record<string, FormAnswerValue>>(() =>
		step.result && step.result.formTemplateId === form.formTemplateId
			? { ...step.result.values }
			: {}
	)
	const [errors, setErrors] = useState<Record<string, string>>({})
	// One key per save, so a double click records one result, not two.
	const [idempotencyKey] = useState(newKey)
	const correcting = step.result !== null

	async function save(event: React.FormEvent) {
		event.preventDefault()
		const check = checkFormAnswers(form.fields, values)
		if (!check.ok) {
			setErrors(check.fieldErrors)
			return
		}
		try {
			await record.mutateAsync({
				stepId: step.stepId,
				formTemplateId: form.formTemplateId,
				answers: check.answers,
				idempotencyKey,
			})
			toast.success(correcting ? `${step.name} result corrected` : `${step.name} result recorded`)
			onDone()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the result")
		}
	}

	return (
		<form
			onSubmit={event => void save(event)}
			className="flex flex-col gap-4 rounded-lg border border-dashed p-3"
		>
			{correcting ? (
				<p className="text-muted-foreground text-xs">
					Saving a correction keeps the current result as an earlier version.
				</p>
			) : null}
			<QuestionnaireFields
				form={{
					serviceId: item.service.id,
					formTemplateId: form.formTemplateId,
					version: form.version,
					fields: form.fields,
				}}
				values={values}
				errors={errors}
				onChange={(fieldId, value) => {
					setValues(current => ({ ...current, [fieldId]: value }))
					setErrors(current => {
						const next = { ...current }
						delete next[fieldId]
						return next
					})
				}}
				idPrefix={`step-${step.stepId}`}
			/>
			<div className="flex gap-2">
				<Button type="submit" size="sm" disabled={record.isPending}>
					{record.isPending ? "Saving…" : correcting ? "Save correction" : "Save result"}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={onDone}
					disabled={record.isPending}
				>
					Cancel
				</Button>
			</div>
		</form>
	)
}
