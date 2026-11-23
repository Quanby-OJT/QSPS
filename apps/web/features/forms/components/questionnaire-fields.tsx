"use client"

import { useState } from "react"

import {
	FORM_UPLOAD_CONTENT_TYPES,
	FORM_UPLOAD_MAX_BYTES,
	type BookingForm,
	type FormAnswerValue,
	type FormField,
} from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { useUploadFormFileMutation } from "@/features/bookings/api/bookings.hooks"

type Values = Readonly<Record<string, FormAnswerValue | undefined>>

interface FieldProps {
	field: FormField
	id: string
	value: FormAnswerValue | undefined
	error: string | undefined
	onChange: (value: FormAnswerValue) => void
}

function RequiredMark({ required }: { required: boolean }) {
	return required ? (
		<>
			<span aria-hidden="true" className="text-destructive">
				{" "}
				*
			</span>
			<span className="sr-only"> (required)</span>
		</>
	) : null
}

function FieldError({ id, error }: { id: string; error: string | undefined }) {
	return error ? (
		<p id={`${id}-error`} className="text-destructive text-sm">
			{error}
		</p>
	) : null
}

/** What a number input holds: a number, the text typed so far, or nothing. */
function numberValue(raw: string, parsed: number): FormAnswerValue {
	if (raw === "") return null
	return Number.isNaN(parsed) ? raw : parsed
}

function textOf(value: FormAnswerValue | undefined): string {
	return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

/**
 * FRM-2: one Service's questionnaire, rendered from its field schema in
 * order. Required questions are marked, and each question shows its own
 * error. File questions upload as soon as a file is chosen; the answer then
 * holds the stored file's key.
 */
export function QuestionnaireFields({
	form,
	values,
	errors,
	onChange,
	idPrefix,
}: {
	form: BookingForm
	values: Values
	errors: Readonly<Record<string, string>>
	onChange: (fieldId: string, value: FormAnswerValue) => void
	idPrefix: string
}) {
	return (
		<div className="flex flex-col gap-5">
			{form.fields.map(field => {
				const key = String(field.id)
				return (
					<QuestionField
						key={key}
						field={field}
						id={`${idPrefix}-${key}`}
						value={values[key]}
						error={errors[key]}
						onChange={value => onChange(key, value)}
					/>
				)
			})}
		</div>
	)
}

function QuestionField(props: FieldProps) {
	const { field, id, value, error, onChange } = props
	const describedBy = error ? `${id}-error` : undefined

	if (
		field.type === "single_choice" ||
		field.type === "multiple_choice" ||
		field.type === "yes_no"
	) {
		return <ChoiceField {...props} />
	}

	if (field.type === "file") {
		return (
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={id}>
					{field.label}
					<RequiredMark required={field.required} />
				</Label>
				<FileAnswer
					id={id}
					value={value}
					invalid={Boolean(error)}
					describedBy={describedBy}
					onChange={onChange}
				/>
				<FieldError id={id} error={error} />
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>
				{field.label}
				<RequiredMark required={field.required} />
			</Label>
			<Input
				id={id}
				type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
				value={textOf(value)}
				maxLength={field.type === "text" ? 1000 : undefined}
				aria-invalid={error ? true : undefined}
				aria-describedby={describedBy}
				onChange={event =>
					onChange(
						field.type === "number"
							? numberValue(event.target.value, event.target.valueAsNumber)
							: event.target.value
					)
				}
			/>
			<FieldError id={id} error={error} />
		</div>
	)
}

function ChoiceField({ field, id, value, error, onChange }: FieldProps) {
	const describedBy = error ? `${id}-error` : undefined
	const choices: { label: string; value: string | boolean }[] =
		field.type === "yes_no"
			? [
					{ label: "Yes", value: true },
					{ label: "No", value: false },
				]
			: (field.options ?? []).map(option => ({ label: option, value: option }))
	const chosen = Array.isArray(value) ? value : []

	return (
		<fieldset
			className="flex flex-col gap-1.5"
			aria-invalid={error ? true : undefined}
			aria-describedby={describedBy}
		>
			<legend className="mb-1 text-sm font-medium">
				{field.label}
				<RequiredMark required={field.required} />
			</legend>
			{choices.map((choice, index) => {
				const choiceId = `${id}-${index}`
				const multiple = field.type === "multiple_choice"
				const checked = multiple ? chosen.includes(String(choice.value)) : value === choice.value
				return (
					<label key={choiceId} htmlFor={choiceId} className="flex items-center gap-2 text-sm">
						<input
							id={choiceId}
							type={multiple ? "checkbox" : "radio"}
							name={id}
							checked={checked}
							className="accent-primary size-4"
							onChange={event => {
								if (!multiple) {
									onChange(choice.value)
									return
								}
								const option = String(choice.value)
								onChange(
									event.target.checked
										? [...chosen, option]
										: chosen.filter(item => item !== option)
								)
							}}
						/>
						{choice.label}
					</label>
				)
			})}
			<FieldError id={id} error={error} />
		</fieldset>
	)
}

function FileAnswer({
	id,
	value,
	invalid,
	describedBy,
	onChange,
}: {
	id: string
	value: FormAnswerValue | undefined
	invalid: boolean
	describedBy: string | undefined
	onChange: (value: FormAnswerValue) => void
}) {
	const upload = useUploadFormFileMutation()
	const [fileName, setFileName] = useState<string | null>(null)
	const [problem, setProblem] = useState<string | null>(null)
	const attached = typeof value === "string" && value.length > 0

	async function choose(file: File | undefined) {
		if (!file) return
		setProblem(null)
		// Checked here for a quick answer; the API checks the content again.
		if (!(FORM_UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) {
			setProblem("Upload a PDF, JPG or PNG file")
			return
		}
		if (file.size > FORM_UPLOAD_MAX_BYTES) {
			setProblem("Files can be at most 5 MB")
			return
		}
		try {
			const uploaded = await upload.mutateAsync(file)
			setFileName(uploaded.fileName)
			onChange(uploaded.fileKey)
		} catch (error) {
			setProblem(error instanceof Error ? error.message : "Could not upload the file")
		}
	}

	return (
		<div className="flex flex-col gap-1.5">
			<Input
				id={id}
				type="file"
				accept="application/pdf,image/jpeg,image/png"
				disabled={upload.isPending}
				aria-invalid={invalid || problem ? true : undefined}
				aria-describedby={describedBy}
				onChange={event => void choose(event.target.files?.[0])}
			/>
			<p className="text-muted-foreground text-xs">PDF, JPG or PNG, up to 5 MB.</p>
			{upload.isPending ? (
				<p className="text-sm" role="status">
					Uploading…
				</p>
			) : attached ? (
				<div className="flex items-center gap-2 text-sm" role="status">
					<span>Attached: {fileName ?? "your file"}</span>
					<Button
						type="button"
						size="xs"
						variant="ghost"
						onClick={() => {
							setFileName(null)
							onChange(null)
						}}
					>
						Remove
					</Button>
				</div>
			) : null}
			{problem ? <p className="text-destructive text-sm">{problem}</p> : null}
		</div>
	)
}
