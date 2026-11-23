"use client"

import { useState } from "react"
import { toast } from "sonner"

import { MIN_OVERRIDE_REASON_LENGTH, type ProcessingItem } from "@repo/contracts"

import { BoqLoader } from "@/core/components/boq-loader"
import { Button } from "@/core/components/ui/button"
import { Label } from "@/core/components/ui/label"
import { Textarea } from "@/core/components/ui/textarea"
import {
	useDecideApprovalMutation,
	useOverrideItemMutation,
} from "@/features/processing/api/processing.hooks"
import { issuesDocument } from "@/features/processing/components/certificate-fields"
import {
	DocumentDetailsFields,
	useDocumentDetailsForm,
} from "@/features/processing/components/document-panels"
import {
	allowsExemption,
	documentTypeLabel,
	itemStatusLabel,
} from "@/features/processing/lib/labels"

function newKey(): string {
	return crypto.randomUUID()
}

/**
 * The document a clearing action issues at once (CRT-1a), with CRT-3's choice
 * between the vaccination details and a medical exemption.
 */
function useClearingDocument(item: ProcessingItem) {
	const form = useDocumentDetailsForm()
	const needsCertificate = issuesDocument(item)
	const allowExemption = allowsExemption(item.service.documentType)
	const exempt = needsCertificate && allowExemption && form.mode === "exempt"
	return {
		form,
		needsCertificate,
		allowExemption,
		exempt,
		missing: needsCertificate && form.missing,
		document: () => (needsCertificate && !exempt ? form.details() : null),
		exemption: () => (exempt ? form.exemptionDetails() : null),
	}
}

/**
 * Shown to everyone on a `pending_head_approval` item (PRC-3). Approvers get
 * Approve and Send back; officers see that the item is waiting.
 */
export function PendingApprovalPanel({
	item,
	canApprove,
}: {
	item: ProcessingItem
	canApprove: boolean
}) {
	if (!canApprove) {
		return (
			<div className="bg-card flex flex-col gap-2 rounded-xl border p-4">
				<h2 className="font-semibold">Waiting for head approval</h2>
				<p className="text-muted-foreground text-sm">
					{item.service.name} needs the head&apos;s sign-off before a document can be issued.
				</p>
			</div>
		)
	}
	return <ApprovalForm item={item} />
}

/**
 * PRC-3 approval. CRT-1a: when the Service issues its document automatically,
 * approving issues it at once, so the approver enters the certificate details,
 * or, for a vaccination, records the medical exemption (CRT-3).
 */
function ApprovalForm({ item }: { item: ProcessingItem }) {
	const decide = useDecideApprovalMutation(item.bookingItemId)
	const [notes, setNotes] = useState("")
	const clearing = useClearingDocument(item)
	// One key per decision, so a double click records one decision, not two.
	const [idempotencyKey, setIdempotencyKey] = useState(newKey)

	async function submit(decision: "approve" | "return") {
		if (decision === "return" && notes.trim().length === 0) {
			toast.error("Write a note telling the officer what to check again")
			return
		}
		if (decision === "approve" && clearing.missing) {
			toast.error("Enter the certificate details before approving")
			return
		}
		try {
			const saved = await decide.mutateAsync({
				decision,
				notes: notes.trim(),
				document: decision === "approve" ? clearing.document() : null,
				exemption: decision === "approve" ? clearing.exemption() : null,
				idempotencyKey,
			})
			setIdempotencyKey(newKey())
			setNotes("")
			toast.success(
				decision === "return"
					? `Sent back to the officer: ${itemStatusLabel(saved.status).toLowerCase()}`
					: saved.document
						? `Approved. ${documentTypeLabel(saved.document.documentType)} ${saved.document.documentNumber} issued.`
						: "Approved: the item is cleared"
			)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the decision")
		}
	}

	return (
		<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
			{decide.isPending ? (
				<BoqLoader
					label={clearing.needsCertificate ? "Issuing the certificate" : "Processing request"}
				/>
			) : null}
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold">Head approval</h2>
				<p className="text-muted-foreground text-sm">
					The officer cleared this item.{" "}
					{clearing.needsCertificate
						? "Approving issues the client's certificate at once."
						: "Approve it, or send it back with a note."}
				</p>
			</div>
			{clearing.needsCertificate ? (
				<DocumentDetailsFields
					form={clearing.form}
					allowExemption={clearing.allowExemption}
					idPrefix="approval"
					intro="Needed only to approve; sending back ignores them."
				/>
			) : null}
			<div className="flex flex-col gap-2">
				<Label htmlFor="approval-notes">Notes (required to send back)</Label>
				<Textarea
					id="approval-notes"
					value={notes}
					onChange={event => setNotes(event.target.value)}
					maxLength={2000}
					rows={3}
				/>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					disabled={decide.isPending || clearing.missing}
					onClick={() => void submit("approve")}
				>
					{decide.isPending
						? "Saving…"
						: clearing.exempt
							? "Approve and issue exemption certificate"
							: clearing.needsCertificate
								? "Approve and issue certificate"
								: "Approve"}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={decide.isPending || notes.trim().length === 0}
					onClick={() => void submit("return")}
				>
					Send back to officer
				</Button>
			</div>
		</div>
	)
}

/**
 * PRC-3: an approver may override a rejected item to cleared, with a reason.
 * CRT-1a: when the Service issues its document automatically, the override
 * issues it at once: the vaccination details, or a medical exemption (CRT-3).
 */
export function OverridePanel({ item }: { item: ProcessingItem }) {
	const override = useOverrideItemMutation(item.bookingItemId)
	const [reason, setReason] = useState("")
	const clearing = useClearingDocument(item)
	const [idempotencyKey, setIdempotencyKey] = useState(newKey)

	const tooShort = reason.trim().length < MIN_OVERRIDE_REASON_LENGTH

	async function submit(event: React.FormEvent) {
		event.preventDefault()
		if (tooShort || clearing.missing) return
		try {
			const saved = await override.mutateAsync({
				reason: reason.trim(),
				document: clearing.document(),
				exemption: clearing.exemption(),
				idempotencyKey,
			})
			setIdempotencyKey(newKey())
			setReason("")
			toast.success(
				saved.document
					? `Override saved. ${documentTypeLabel(saved.document.documentType)} ${saved.document.documentNumber} issued.`
					: "Override saved: the item is cleared"
			)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the override")
		}
	}

	return (
		<form
			onSubmit={event => void submit(event)}
			className="bg-card flex flex-col gap-4 rounded-xl border p-4"
		>
			{override.isPending ? (
				<BoqLoader
					label={clearing.needsCertificate ? "Issuing the certificate" : "Processing request"}
				/>
			) : null}
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold">Override rejection</h2>
				<p className="text-muted-foreground text-sm">
					Clear this rejected item. The reason is recorded in the audit log with the before and
					after status.
					{clearing.needsCertificate ? " The client's certificate is issued at once." : ""}
				</p>
			</div>
			{clearing.needsCertificate ? (
				<DocumentDetailsFields
					form={clearing.form}
					allowExemption={clearing.allowExemption}
					idPrefix="override"
					intro="Overriding issues the client's certificate at once."
				/>
			) : null}
			<div className="flex flex-col gap-2">
				<Label htmlFor="override-reason">
					Reason (required, at least {MIN_OVERRIDE_REASON_LENGTH} characters)
				</Label>
				<Textarea
					id="override-reason"
					value={reason}
					onChange={event => setReason(event.target.value)}
					maxLength={2000}
					rows={3}
					aria-invalid={(reason.length > 0 && tooShort) || undefined}
				/>
			</div>
			<Button
				type="submit"
				disabled={override.isPending || tooShort || clearing.missing}
				className="self-start"
			>
				{override.isPending
					? "Saving…"
					: clearing.exempt
						? "Override and issue exemption certificate"
						: clearing.needsCertificate
							? "Override and issue certificate"
							: "Override to cleared"}
			</Button>
		</form>
	)
}
