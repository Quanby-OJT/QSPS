"use client"

import { useState } from "react"
import { AccountSetting01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "sonner"

import type { Policy } from "@repo/contracts"

import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
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
import { ApiError } from "@/core/lib/api-error"
import { usePoliciesQuery, useUpdatePolicyMutation } from "@/features/policies/api/policies.hooks"
import {
	changedLabel,
	draftOf,
	formatPolicyValue,
	groupPolicies,
	isChanged,
	parseDraft,
	type PolicyDraft,
} from "@/features/policies/lib/policy-form"

/**
 * ADM-6: booking, payment and sign-in Policies (TOR §VIII.3, Annex B).
 *
 * Every registered key is listed, grouped by area, so a key added to the
 * registry by a later ticket appears here without a screen change. Each row
 * saves on its own; the value is checked with the same rule the API applies.
 */
export function PoliciesView() {
	const query = usePoliciesQuery()
	const forbidden = query.error instanceof ApiError && query.error.status === 403

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				icon={AccountSetting01Icon}
				title="Policies"
				description="Booking, payment and sign-in rules. A change applies to the next action and is recorded in the audit log."
			/>

			{forbidden ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<HugeiconsIcon icon={AccountSetting01Icon} strokeWidth={2} />
						</EmptyMedia>
						<EmptyTitle>You do not have access to policies</EmptyTitle>
						<EmptyDescription>
							Changing policies needs the settings.policies:manage permission. Ask an administrator
							if you need it. This attempt has been recorded.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : query.isPending ? (
				<div className="flex flex-col gap-3" role="status" aria-label="Loading policies">
					<Skeleton className="h-40 w-full rounded-xl" />
					<Skeleton className="h-28 w-full rounded-xl" />
					<Skeleton className="h-32 w-full rounded-xl" />
				</div>
			) : query.isError ? (
				<div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load policies.</p>
					<p className="text-muted-foreground mt-1 text-sm">{query.error.message}</p>
					<Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
						Retry
					</Button>
				</div>
			) : (
				groupPolicies(query.data).map(group => (
					<section
						key={group.area}
						className="bg-card rounded-xl border p-4"
						aria-labelledby={`policy-area-${group.area}`}
					>
						<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
						<h2 id={`policy-area-${group.area}`} className="text-lg font-bold tracking-tight">
							{group.label}
						</h2>
						<div className="mt-2 flex flex-col">
							{group.policies.map(policy => (
								// Keyed on the stored value too, so the row starts from the saved value after a save.
								<PolicyRow key={`${policy.key}:${String(policy.value)}`} policy={policy} />
							))}
						</div>
					</section>
				))
			)}
		</section>
	)
}

function PolicyRow({ policy }: { policy: Policy }) {
	const update = useUpdatePolicyMutation()
	const [draft, setDraft] = useState<PolicyDraft>(() => draftOf(policy))
	const [error, setError] = useState<string | null>(null)

	const fieldId = `policy-${policy.key.replaceAll(".", "-")}`
	const messageId = `${fieldId}-message`
	const changed = isChanged(policy, draft)
	const changedBy = changedLabel(policy)

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const parsed = parseDraft(policy, draft)
		if (!parsed.ok) {
			setError(parsed.message)
			return
		}
		setError(null)
		try {
			await update.mutateAsync({ key: policy.key, value: parsed.value })
			toast.success(`${policy.label} saved`)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : `Could not save ${policy.label}`)
		}
	}

	return (
		<form
			aria-label={policy.label}
			// The row shows the registry's own message; the browser's would differ.
			noValidate
			onSubmit={event => void save(event)}
			className="flex flex-col gap-3 border-t py-4 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
		>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<Label htmlFor={fieldId} className="font-semibold">
						{policy.label}
					</Label>
					<Badge variant={policy.isDefault ? "secondary" : "default"}>
						{policy.isDefault ? "Default" : "Changed"}
					</Badge>
				</div>
				<p className="text-muted-foreground mt-1 text-sm">{policy.description}</p>
				<p className="text-muted-foreground mt-1 text-xs">
					Default: {formatPolicyValue(policy, policy.defaultValue)}
					{changedBy ? ` · ${changedBy}` : null}
				</p>
			</div>

			<div className="flex flex-col gap-1.5 sm:w-64 sm:shrink-0">
				<div className="flex items-center gap-2">
					{policy.type === "boolean" ? (
						<div className="flex h-9 items-center gap-2">
							<input
								id={fieldId}
								type="checkbox"
								checked={draft === true}
								onChange={event => {
									setDraft(event.target.checked)
									setError(null)
								}}
								aria-describedby={messageId}
								className="accent-primary size-4"
							/>
							<span className="text-sm" aria-hidden="true">
								{draft === true ? "On" : "Off"}
							</span>
						</div>
					) : (
						<>
							<Input
								id={fieldId}
								type="number"
								inputMode="numeric"
								min={policy.min ?? undefined}
								max={policy.max ?? undefined}
								step={1}
								value={typeof draft === "string" ? draft : ""}
								onChange={event => {
									setDraft(event.target.value)
									setError(null)
								}}
								aria-invalid={error ? true : undefined}
								aria-describedby={messageId}
								className="w-28"
							/>
							{policy.unit ? (
								<span className="text-muted-foreground text-sm">{policy.unit}</span>
							) : null}
						</>
					)}
					<Button
						type="submit"
						size="sm"
						className="ml-auto"
						disabled={!changed || update.isPending}
					>
						{update.isPending ? "Saving…" : "Save"}
					</Button>
				</div>
				{error ? (
					<p id={messageId} role="alert" className="text-destructive text-xs">
						{error}
					</p>
				) : (
					<p id={messageId} className="text-muted-foreground text-xs">
						{policy.type === "integer"
							? `From ${String(policy.min)} to ${String(policy.max)}`
							: "On or off"}
					</p>
				)}
			</div>
		</form>
	)
}
