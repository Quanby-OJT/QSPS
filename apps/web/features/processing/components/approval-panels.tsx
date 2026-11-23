"use client"

import { useState } from "react"
import { toast } from "sonner"

import { MIN_OVERRIDE_REASON_LENGTH, type ProcessingItem } from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { Label } from "@/core/components/ui/label"
import { Textarea } from "@/core/components/ui/textarea"
import {
	useDecideApprovalMutation,
	useOverrideItemMutation,
} from "@/features/processing/api/processing.hooks"
import { itemStatusLabel } from "@/features/processing/lib/labels"

function newKey(): string {
	return crypto.randomUUID()
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

function ApprovalForm({ item }: { item: ProcessingItem }) {
	const decide = useDecideApprovalMutation(item.bookingItemId)
	const [notes, setNotes] = useState("")
	// One key per decision, so a double click records one decision, not two.
	const [idempotencyKey, setIdempotencyKey] = useState(newKey)

	async function submit(decision: "approve" | "return") {
		if (decision === "return" && notes.trim().length === 0) {
			toast.error("Write a note telling the officer what to check again")
			return
		}
		try {
			const saved = await decide.mutateAsync({ decision, notes: notes.trim(), idempotencyKey })
			setIdempotencyKey(newKey())
			setNotes("")
			toast.success(
				decision === "approve"
					? "Approved: the item is cleared"
					: `Sent back to the officer: ${itemStatusLabel(saved.status).toLowerCase()}`
			)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the decision")
		}
	}

	return (
		<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold">Head approval</h2>
				<p className="text-muted-foreground text-sm">
					The officer cleared this item. Approve it so a document can be issued, or send it back
					with a note.
				</p>
			</div>
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
				<Button type="button" disabled={decide.isPending} onClick={() => void submit("approve")}>
					{decide.isPending ? "Saving…" : "Approve"}
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

/** PRC-3: an approver may override a rejected item to cleared, with a reason. */
export function OverridePanel({ item }: { item: ProcessingItem }) {
	const override = useOverrideItemMutation(item.bookingItemId)
	const [reason, setReason] = useState("")
	const [idempotencyKey, setIdempotencyKey] = useState(newKey)
	const tooShort = reason.trim().length < MIN_OVERRIDE_REASON_LENGTH

	async function submit(event: React.FormEvent) {
		event.preventDefault()
		if (tooShort) return
		try {
			await override.mutateAsync({ reason: reason.trim(), idempotencyKey })
			setIdempotencyKey(newKey())
			setReason("")
			toast.success("Override saved: the item is cleared")
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the override")
		}
	}

	return (
		<form
			onSubmit={event => void submit(event)}
			className="bg-card flex flex-col gap-4 rounded-xl border p-4"
		>
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold">Override rejection</h2>
				<p className="text-muted-foreground text-sm">
					Clear this rejected item. The reason is recorded in the audit log with the before and
					after status.
				</p>
			</div>
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
			<Button type="submit" disabled={override.isPending || tooShort} className="self-start">
				{override.isPending ? "Saving…" : "Override to cleared"}
			</Button>
		</form>
	)
}
