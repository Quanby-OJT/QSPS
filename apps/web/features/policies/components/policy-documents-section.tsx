"use client"

import { useState } from "react"
import { toast } from "sonner"

import {
	MAX_POLICY_BODY_LENGTH,
	MAX_POLICY_TITLE_LENGTH,
	type PolicyDocument,
} from "@repo/contracts"

import { Badge } from "@/core/components/ui/badge"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { ApiError } from "@/core/lib/api-error"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	useCreatePolicyDocumentMutation,
	usePolicyDocumentsQuery,
	useUpdatePolicyDocumentMutation,
	useWithdrawPolicyDocumentMutation,
} from "@/features/policies/api/policy-documents.hooks"
import { PolicyText } from "@/features/policies/components/policy-text"
import {
	appliesToLabel,
	draftFrom,
	emptyDraft,
	formatPolicyDate,
	parsePolicyDraft,
	stateLabel,
	type PolicyDraft,
} from "@/features/policies/lib/policy-documents"
import { useAvailableServicesQuery } from "@/features/services/api/services.hooks"

/** Which editor is open: none, a new policy, or the next version of one. */
type Editing = { mode: "new" } | { mode: "edit"; policy: PolicyDocument } | null

/**
 * ADM-9: written policies clients read, and may have to accept, at booking.
 * Shown on the Policies page under the rule values. A user without
 * settings.policies:manage already sees the page's no-access message, so this
 * section renders nothing for them.
 */
export function PolicyDocumentsSection() {
	const query = usePolicyDocumentsQuery()
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const [editing, setEditing] = useState<Editing>(null)

	if (query.error instanceof ApiError && query.error.status === 403) return null
	const loading = !hydrated || isQueryLoading(query)

	return (
		<section className="bg-card rounded-xl border p-4" aria-labelledby="policy-documents-heading">
			<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 id="policy-documents-heading" className="text-lg font-bold tracking-tight">
						Booking terms
					</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Written policies clients read on the booking review step. Editing publishes a new
						version; clients who accepted an earlier one keep it.
					</p>
				</div>
				{editing === null ? (
					<Button type="button" size="sm" onClick={() => setEditing({ mode: "new" })}>
						New policy
					</Button>
				) : null}
			</div>

			{editing ? (
				<PolicyEditor
					key={editing.mode === "edit" ? editing.policy.id : "new"}
					policy={editing.mode === "edit" ? editing.policy : null}
					onClose={() => setEditing(null)}
				/>
			) : null}

			{loading ? (
				<div className="mt-4 flex flex-col gap-2" role="status" aria-label="Loading booking terms">
					<Skeleton className="h-20 w-full rounded-lg" />
					<Skeleton className="h-20 w-full rounded-lg" />
				</div>
			) : query.isError ? (
				<div className="border-destructive/30 bg-destructive/5 mt-4 rounded-lg border p-4">
					<p className="text-sm font-medium">Could not load the booking terms.</p>
					<p className="text-muted-foreground mt-1 text-sm">{query.error.message}</p>
					<Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>
						Retry
					</Button>
				</div>
			) : !query.data || query.data.length === 0 ? (
				<p className="text-muted-foreground mt-4 text-sm">
					No written policies yet. Clients book without reading any terms.
				</p>
			) : (
				<ul className="mt-2 flex flex-col">
					{query.data.map(policy => (
						<PolicyRow
							key={`${policy.id}:${policy.state}`}
							policy={policy}
							onEdit={() => setEditing({ mode: "edit", policy })}
							editingDisabled={editing !== null}
						/>
					))}
				</ul>
			)}
		</section>
	)
}

function PolicyRow({
	policy,
	onEdit,
	editingDisabled,
}: {
	policy: PolicyDocument
	onEdit: () => void
	editingDisabled: boolean
}) {
	const withdraw = useWithdrawPolicyDocumentMutation()
	const [confirming, setConfirming] = useState(false)
	const [showText, setShowText] = useState(false)
	const withdrawn = policy.state === "withdrawn"

	async function confirmWithdraw() {
		try {
			await withdraw.mutateAsync(policy.documentKey)
			toast.success(`${policy.title} withdrawn`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not withdraw the policy")
		} finally {
			setConfirming(false)
		}
	}

	return (
		<li className="flex flex-col gap-2 border-t py-4 first:border-t-0" aria-label={policy.title}>
			<div className="flex flex-wrap items-center gap-2">
				<p className="font-semibold">{policy.title}</p>
				<Badge variant={policy.state === "in_effect" ? "default" : "secondary"}>
					{stateLabel(policy)}
				</Badge>
				<Badge variant="outline">{policy.requiresAcceptance ? "Must accept" : "For reading"}</Badge>
			</div>
			<p className="text-muted-foreground text-xs">
				Version {policy.version} · {appliesToLabel(policy)} · from{" "}
				{formatPolicyDate(policy.effectiveFrom)}
				{policy.createdByEmail ? ` · by ${policy.createdByEmail}` : null}
			</p>
			{policy.olderVersionInEffect ? (
				<p className="text-muted-foreground text-xs">
					The previous version applies until this one starts.
				</p>
			) : null}
			{showText ? <PolicyText body={policy.body} className="bg-muted/40 rounded-lg p-3" /> : null}
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-expanded={showText}
					onClick={() => setShowText(current => !current)}
				>
					{showText ? "Hide text" : "Show text"}
				</Button>
				{withdrawn ? null : (
					<>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={editingDisabled}
							onClick={onEdit}
						>
							Edit
						</Button>
						{confirming ? (
							<>
								<Button
									type="button"
									variant="destructive"
									size="sm"
									disabled={withdraw.isPending}
									onClick={() => void confirmWithdraw()}
								>
									{withdraw.isPending ? "Withdrawing…" : "Confirm withdraw"}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => setConfirming(false)}
								>
									Keep it
								</Button>
							</>
						) : (
							<Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
								Withdraw
							</Button>
						)}
					</>
				)}
			</div>
		</li>
	)
}

function PolicyEditor({ policy, onClose }: { policy: PolicyDocument | null; onClose: () => void }) {
	const services = useAvailableServicesQuery()
	const create = useCreatePolicyDocumentMutation()
	const update = useUpdatePolicyDocumentMutation()
	const [draft, setDraft] = useState<PolicyDraft>(() => (policy ? draftFrom(policy) : emptyDraft()))
	const [error, setError] = useState<string | null>(null)
	const saving = create.isPending || update.isPending

	function change(patch: Partial<PolicyDraft>) {
		setDraft(current => ({ ...current, ...patch }))
		setError(null)
	}

	function toggleService(serviceId: number, checked: boolean) {
		change({
			serviceIds: checked
				? [...draft.serviceIds, serviceId]
				: draft.serviceIds.filter(id => id !== serviceId),
		})
	}

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const parsed = parsePolicyDraft(draft)
		if (!parsed.ok) {
			setError(parsed.message)
			return
		}
		try {
			if (policy) {
				await update.mutateAsync({ ...parsed.value, documentKey: policy.documentKey })
				toast.success(`${parsed.value.title}: version ${policy.version + 1} published`)
			} else {
				await create.mutateAsync(parsed.value)
				toast.success(`${parsed.value.title} published`)
			}
			onClose()
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Could not save the policy")
		}
	}

	return (
		<form
			aria-label={policy ? `Edit ${policy.title}` : "New policy"}
			noValidate
			onSubmit={event => void save(event)}
			className="border-primary/40 bg-muted/30 mt-4 flex flex-col gap-4 rounded-lg border p-4"
		>
			<p className="text-sm font-semibold">
				{policy ? `New version of “${policy.title}” (version ${policy.version + 1})` : "New policy"}
			</p>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="policy-title">Title</Label>
				<Input
					id="policy-title"
					value={draft.title}
					maxLength={MAX_POLICY_TITLE_LENGTH}
					onChange={event => change({ title: event.target.value })}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor="policy-body">Text</Label>
				<textarea
					id="policy-body"
					rows={8}
					value={draft.body}
					maxLength={MAX_POLICY_BODY_LENGTH}
					onChange={event => change({ body: event.target.value })}
					className="border-input bg-background focus-visible:ring-ring/50 min-h-32 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
				/>
				<p className="text-muted-foreground text-xs">
					Plain text. Leave a blank line between paragraphs.
				</p>
			</div>

			<fieldset className="flex flex-col gap-2">
				<legend className="text-sm font-medium">Applies to</legend>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="policy-applies"
						checked={draft.appliesToAllServices}
						onChange={() => change({ appliesToAllServices: true })}
						className="accent-primary size-4"
					/>
					All services
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="policy-applies"
						checked={!draft.appliesToAllServices}
						onChange={() => change({ appliesToAllServices: false })}
						className="accent-primary size-4"
					/>
					Chosen services
				</label>
				{draft.appliesToAllServices ? null : services.isPending ? (
					<p className="text-muted-foreground text-sm" role="status">
						Loading services…
					</p>
				) : services.isError ? (
					<p className="text-destructive text-sm">Could not load the services.</p>
				) : (
					<div className="grid gap-1 pl-6 sm:grid-cols-2">
						{services.data.map(service => (
							<label key={service.id} className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={draft.serviceIds.includes(service.id)}
									onChange={event => toggleService(service.id, event.target.checked)}
									className="accent-primary size-4"
								/>
								{service.name}
							</label>
						))}
					</div>
				)}
			</fieldset>

			<div className="grid gap-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="policy-effective">Effective from</Label>
					<Input
						id="policy-effective"
						type="date"
						value={draft.effectiveFrom}
						onChange={event => change({ effectiveFrom: event.target.value })}
					/>
				</div>
				<label className="flex items-center gap-2 self-end pb-2 text-sm">
					<input
						type="checkbox"
						checked={draft.requiresAcceptance}
						onChange={event => change({ requiresAcceptance: event.target.checked })}
						className="accent-primary size-4"
					/>
					Clients must accept it to book
				</label>
			</div>

			{error ? (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			) : null}

			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={saving}>
					{saving ? "Publishing…" : policy ? "Publish new version" : "Publish"}
				</Button>
				<Button type="button" variant="outline" onClick={onClose} disabled={saving}>
					Cancel
				</Button>
			</div>
		</form>
	)
}
