"use client"

import { useForm } from "@tanstack/react-form"

import { GENDER_OPTIONS, UpdateClientProfileSchema } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { Card, CardContent } from "@/core/components/ui/card"
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@/core/components/ui/field"
import { Input } from "@/core/components/ui/input"

import { useCompleteProfileMutation } from "../api/complete-profile.hooks"

type FieldName = "name" | "mobile" | "birthDate" | "nationality" | "gender"

const FIELDS: Array<{
	name: FieldName
	label: string
	type: string
	placeholder: string
	autoComplete: string
	description?: string
}> = [
	{
		name: "name",
		label: "Full name",
		type: "text",
		placeholder: "Juan Dela Cruz",
		autoComplete: "name",
	},
	{
		name: "mobile",
		label: "Mobile number",
		type: "tel",
		placeholder: "0917 123 4567",
		autoComplete: "tel",
		description: "Philippine or international number.",
	},
	{ name: "birthDate", label: "Birth date", type: "date", placeholder: "", autoComplete: "bday" },
	{
		name: "nationality",
		label: "Nationality",
		type: "text",
		placeholder: "Filipino",
		autoComplete: "country-name",
	},
	{
		name: "gender",
		label: "Gender",
		type: "text",
		placeholder: "Choose or type your own",
		autoComplete: "sex",
		description: "Pick a suggestion or describe your gender in your own words.",
	},
]

/**
 * First-sign-in profile (AUTH-1). Every field is required before the portal
 * opens. Gender accepts any text; the list only offers suggestions.
 */
export function CompleteProfileForm({ defaultName }: { defaultName: string }) {
	const { mutateAsync: saveProfile, isPending, isError, error } = useCompleteProfileMutation()

	const form = useForm({
		defaultValues: {
			name: defaultName,
			mobile: "",
			birthDate: "",
			nationality: "",
			gender: "",
		},
		validators: {
			onSubmit: UpdateClientProfileSchema,
		},
		onSubmit: async ({ value }) => {
			// The mutation stores the error, and the banner below reads that state.
			await saveProfile(UpdateClientProfileSchema.parse(value)).catch(() => null)
		},
	})

	return (
		<Card>
			<CardContent className="p-6 md:p-8">
				<form
					onSubmit={e => {
						e.preventDefault()
						form.handleSubmit()
					}}
				>
					<FieldGroup>
						<div className="flex flex-col items-center gap-2 text-center">
							<h1 className="text-2xl font-bold">Complete your profile</h1>
							<p className="text-muted-foreground text-balance">
								We need a few details before you can book BOQ services.
							</p>
						</div>

						{isError && (
							<div className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm">
								{error instanceof Error ? error.message : "An unexpected error occurred"}
							</div>
						)}

						{FIELDS.map(config => (
							<form.Field
								key={config.name}
								name={config.name}
								children={field => {
									const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
									return (
										<Field data-invalid={isInvalid}>
											<FieldLabel htmlFor={field.name}>{config.label}</FieldLabel>
											<Input
												id={field.name}
												name={field.name}
												type={config.type}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={e => field.handleChange(e.target.value)}
												aria-invalid={isInvalid}
												placeholder={config.placeholder}
												autoComplete={config.autoComplete}
												list={config.name === "gender" ? "gender-options" : undefined}
												required
												disabled={isPending}
											/>
											{config.description && (
												<FieldDescription>{config.description}</FieldDescription>
											)}
											{isInvalid && <FieldError errors={field.state.meta.errors} />}
										</Field>
									)
								}}
							/>
						))}

						<datalist id="gender-options">
							{GENDER_OPTIONS.map(option => (
								<option key={option} value={option} />
							))}
						</datalist>

						<Field>
							<Button type="submit" disabled={isPending} className="w-full hover:cursor-pointer">
								{isPending ? "Saving..." : "Save and continue"}
							</Button>
						</Field>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	)
}
