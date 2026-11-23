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
import {
	CertificateFields,
	emptyCertificate,
	isCertificateComplete,
	issuesDocument,
	toIssueDetails,
	type CertificateDraft,
} from "@/features/processing/components/certificate-fields"
import { itemStatusLabel } from "@/features/processing/lib/labels"

function newKey(): string {
	return crypto.randomUUID()
}

/** The certificate draft for one form, and a setter for one field. */
function useCertificateDraft() {
	const [certificate, setCertificate] = useState<CertificateDraft>(emptyCertificate)
	function setField(field: keyof CertificateDraft, value: string) {
		setCertificate(current => ({ ...current, [field]: value }))
	}
	return { certificate, setField, reset: () => setCertificate(emptyCertificate()) }
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
 * approving issues it at once, so the approver enters the certificate details.
 */
function ApprovalForm({ item }: { item: ProcessingItem }) {
	const decide = useDecideApprovalMutation(item.bookingItemId)
	const [notes, setNotes] = useState("")
	const { certificate, setField, reset } = useCertificateDraft()
	// One key per decision, so a double click records one decision, not two.
	const [idempotencyKey, setIdempotencyKey] = useState(newKey)

	const needsCertificate = issuesDocument(item)
	const certificateMissing = needsCertificate && !isCertificateComplete(certificate)

	async function submit(decision: "approve" | "return") {
		if (decision === "return" && notes.trim().length === 0) {
			toast.error("Write a note telling the officer what to check again")
			return
		}
		if (decision === "approve" && certificateMissing) {
			toast.error("Enter the certificate details before approving")
			return
		}
		try {
			const saved = await decide.mutateAsync({
				decision,
				notes: notes.trim(),
				document: decision === "approve" && needsCertificate ? toIssueDetails(certificate) : null,
				idempotencyKey,
			})
			setIdempotencyKey(newKey())
			setNotes("")
			reset()
			toast.success(
				decision === "return"
					? `Sent back to the officer: ${itemStatusLabel(saved.status).toLowerCase()}`
					: saved.document
						? `Approved. Document ${saved.document.documentNumber} issued.`
						: "Approved: the item is cleared"
			)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the decision")
		}
	}

	return (
		<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
			{decide.isPending ? (
				<BoqLoader label={needsCertificate ? "Issuing the certificate" : "Processing request"} />
			) : null}
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold">Head approval</h2>
				<p className="text-muted-foreground text-sm">
					The officer cleared this item.{" "}
					{needsCertificate
						? "Approving issues the client's certificate at once."
						: "Approve it, or send it back with a note."}
				</p>
			</div>
			{needsCertificate ? (
				<CertificateFields
					value={certificate}
					onChange={setField}
					idPrefix="approval-certificate"
					description="Needed only to approve; sending back ignores them."
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
					disabled={decide.isPending || certificateMissing}
					onClick={() => void submit("approve")}
				>
					{decide.isPending
						? "Saving…"
						: needsCertificate
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
 * issues it at once, so the approver enters the certificate details.
 */
export function OverridePanel({ item }: { item: ProcessingItem }) {
	const override = useOverrideItemMutation(item.bookingItemId)
	const [reason, setReason] = useState("")
	const { certificate, setField, reset } = useCertificateDraft()
	const [idempotencyKey, setIdempotencyKey] = useState(newKey)

	const tooShort = reason.trim().length < MIN_OVERRIDE_REASON_LENGTH
	const needsCertificate = issuesDocument(item)
	const certificateMissing = needsCertificate && !isCertificateComplete(certificate)

	async function submit(event: React.FormEvent) {
		event.preventDefault()
		if (tooShort || certificateMissing) return
		try {
			const saved = await override.mutateAsync({
				reason: reason.trim(),
				document: needsCertificate ? toIssueDetails(certificate) : null,
				idempotencyKey,
			})
			setIdempotencyKey(newKey())
			setReason("")
			reset()
			toast.success(
				saved.document
					? `Override saved. Document ${saved.document.documentNumber} issued.`
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
				<BoqLoader label={needsCertificate ? "Issuing the certificate" : "Processing request"} />
			) : null}
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold">Override rejection</h2>
				<p className="text-muted-foreground text-sm">
					Clear this rejected item. The reason is recorded in the audit log with the before and
					after status.
					{needsCertificate ? " The client's certificate is issued at once." : ""}
				</p>
			</div>
			{needsCertificate ? (
				<CertificateFields
					value={certificate}
					onChange={setField}
					idPrefix="override-certificate"
					description="Overriding issues the client's vaccination certificate at once."
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
				disabled={override.isPending || tooShort || certificateMissing}
				className="self-start"
			>
				{override.isPending
					? "Saving…"
					: needsCertificate
						? "Override and issue certificate"
						: "Override to cleared"}
			</Button>
		</form>
	)
}
