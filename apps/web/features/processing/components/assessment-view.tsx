"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import type { AssessmentOutcome, ProcessingItem } from "@repo/contracts"

import { BoqLoader } from "@/core/components/boq-loader"
import { PageHeader } from "@/core/components/page-header"
import { Badge } from "@/core/components/ui/badge"
import { Button, buttonVariants } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Textarea } from "@/core/components/ui/textarea"
import { useHydrated } from "@/core/hooks/use-hydrated"
import { cn } from "@/core/lib/utils"
import { useIsQueryLoading } from "@/services/tanstack-query/use-query-loading"
import {
	answerFileUrl,
	useOpenItemMutation,
	useProcessingItemQuery,
	useRecordAssessmentMutation,
} from "@/features/processing/api/processing.hooks"
import {
	OverridePanel,
	PendingApprovalPanel,
} from "@/features/processing/components/approval-panels"
import {
	DocumentDetailsFields,
	IssuedDocumentPanel,
	IssueDocumentPanel,
	useDocumentDetailsForm,
} from "@/features/processing/components/document-panels"
import { PrintoutsPanel } from "@/features/processing/components/printouts-panel"
import { StepsPanel } from "@/features/processing/components/steps-panel"
import {
	allowsExemption,
	canDecideApproval,
	canOpen,
	canOverride,
	correctionsFromRows,
	documentTypeLabel,
	itemStatusLabel,
	needsIssuing,
	outcomeLabel,
	pendingRequiredSteps,
} from "@/features/processing/lib/labels"
import { printoutsFor } from "@/features/processing/lib/printouts"
import { manilaDateKey, slotTimeRange } from "@/features/schedules/lib/calendar"

const OUTCOMES: { value: AssessmentOutcome; label: string; hint: string }[] = [
	{ value: "cleared", label: "Clear", hint: "Information verified; the service can be rendered." },
	{
		value: "returned",
		label: "Return",
		hint: "The client must correct something before you continue.",
	},
	{ value: "rejected", label: "Reject", hint: "The service cannot be rendered for this booking." },
]

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
	timeZone: "Asia/Manila",
	dateStyle: "medium",
	timeStyle: "short",
})

function pesos(centavos: number): string {
	return `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="text-sm font-medium">{value || "—"}</dd>
		</div>
	)
}

function newKey(): string {
	return crypto.randomUUID()
}

function emptyRow() {
	return { id: newKey(), field: "", value: "" }
}

/** Whether clearing this item issues its document at once (CRT-1). */
function issuesOnClear(item: ProcessingItem): boolean {
	return (
		item.service.autoIssue && item.service.documentType !== null && !item.service.requiresApproval
	)
}

/**
 * Assessment screen (PRC-1, TOR §VIII.3): the client's profile and Form
 * Submission answers, the assessment history, and the form to clear, return
 * or reject the Booking Item. When clearing issues a document at once
 * (CRT-1), the form also asks for the certificate details, or, for a
 * vaccination, the medical exemption (CRT-3). An issued document can be
 * printed from here, the vaccination record onto the yellow card (CRT-3).
 *
 * Hydration-safe: the server and the client's first render both show the
 * loading line, even when the client already holds a restored copy.
 */
export function AssessmentView({
	bookingItemId,
	canApprove = false,
	canIssue = false,
	canPrint = false,
	canRevoke = false,
}: {
	bookingItemId: number
	/** PRC-3: the caller holds processing.assessments:approve. */
	canApprove?: boolean
	/** CRT-3: the caller holds certificates.documents:issue. */
	canIssue?: boolean
	/** CRT-3: the caller holds certificates.documents:print. */
	canPrint?: boolean
	/** CRT-8: the caller holds certificates.documents:revoke. */
	canRevoke?: boolean
}) {
	const item = useProcessingItemQuery(bookingItemId)
	// Hydration-safe: loading on the server and on the client's first render,
	// even when a restored copy is already there, so the two renders agree.
	const isQueryLoading = useIsQueryLoading()
	const hydrated = useHydrated()
	const loading = !hydrated || isQueryLoading(item) || (!item.isError && !item.data)

	return (
		<section className="flex w-full flex-col gap-6">
			<PageHeader
				title="Assessment"
				description="Verify the client's information, then clear, return or reject the booking."
				actions={
					<Link href="/processing" className={cn(buttonVariants({ variant: "outline" }))}>
						Back to queue
					</Link>
				}
			/>
			{loading ? (
				<p className="text-muted-foreground text-sm" role="status">
					Loading…
				</p>
			) : item.error ? (
				<p className="text-destructive text-sm" role="alert">
					{item.error.message}
				</p>
			) : item.data ? (
				<AssessmentBody
					item={item.data}
					canApprove={canApprove}
					canIssue={canIssue}
					canPrint={canPrint}
					canRevoke={canRevoke}
				/>
			) : null}
		</section>
	)
}

function AssessmentBody({
	item,
	canApprove,
	canIssue,
	canPrint,
	canRevoke,
}: {
	item: ProcessingItem
	canApprove: boolean
	canIssue: boolean
	canPrint: boolean
	canRevoke: boolean
}) {
	const openItem = useOpenItemMutation(item.bookingItemId)
	const formAnswers = Object.entries(item.formAnswers)

	async function startAssessment() {
		try {
			await openItem.mutateAsync()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not open the assessment")
		}
	}

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			<div className="flex flex-col gap-6">
				<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h2 className="font-semibold">Booking</h2>
						<div className="flex gap-2">
							<Badge variant={item.paymentStatus === "paid" ? "secondary" : "destructive"}>
								{item.paymentStatus === "paid" ? "Paid" : "Unpaid"}
							</Badge>
							<Badge variant="outline">{itemStatusLabel(item.status)}</Badge>
						</div>
					</div>
					<dl className="grid grid-cols-2 gap-3">
						<Detail
							label="Reference Number"
							value={<span className="font-mono">{item.booking.referenceNumber}</span>}
						/>
						<Detail label="Service" value={item.service.name} />
						<Detail label="Location" value={item.location.name} />
						<Detail
							label="Schedule"
							value={`${manilaDateKey(item.startsAt)}, ${slotTimeRange(item)}`}
						/>
						<Detail label="Fee" value={pesos(item.feeCentavos)} />
						<Detail
							label="Head approval"
							value={item.service.requiresApproval ? "Required after clearing" : "Not required"}
						/>
					</dl>
				</div>

				<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
					<h2 className="font-semibold">Client profile</h2>
					<dl className="grid grid-cols-2 gap-3">
						<Detail label="Name" value={item.client.name} />
						<Detail label="Email" value={item.client.email ?? "No email"} />
						<Detail label="Mobile" value={item.client.mobile} />
						<Detail label="Birth date" value={item.client.birthDate} />
						<Detail label="Gender" value={item.client.gender} />
						<Detail label="Nationality" value={item.client.nationality} />
					</dl>
				</div>

				<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
					<h2 className="font-semibold">Form answers</h2>
					{formAnswers.length === 0 ? (
						<p className="text-muted-foreground text-sm">No form was submitted for this service.</p>
					) : (
						<dl className="grid grid-cols-2 gap-3">
							{formAnswers.map(([field, answer]) => (
								<Detail
									key={field}
									label={field}
									value={
										item.formFiles?.some(file => file.label === field) ? (
											<a
												href={answerFileUrl(
													item.bookingItemId,
													item.formFiles.find(file => file.label === field)?.fieldId ?? 0
												)}
												className="text-primary underline underline-offset-2"
												target="_blank"
												rel="noopener noreferrer"
											>
												Download
											</a>
										) : typeof answer === "string" ? (
											answer
										) : (
											JSON.stringify(answer)
										)
									}
								/>
							))}
						</dl>
					)}
				</div>
			</div>

			<div className="flex flex-col gap-6">
				{/* PRC-4: the Service's steps, recorded before the item can be cleared. */}
				{/* `?? []`: an item cached before steps existed has none until it refetches. */}
				{(item.steps ?? []).length > 0 ? (
					<StepsPanel
						item={item}
						canRecord={item.status === "in_assessment" || item.status === "checked_in"}
					/>
				) : null}

				{canOpen(item.status) ? (
					<div className="bg-card flex flex-col items-start gap-3 rounded-xl border p-4">
						<h2 className="font-semibold">
							{item.status === "returned" ? "The client is back" : "Ready to assess"}
						</h2>
						<p className="text-muted-foreground text-sm">
							{item.status === "returned"
								? "Open the assessment again once the client has made the corrections."
								: "Open the assessment when the client is in front of you."}
						</p>
						<Button
							type="button"
							onClick={() => void startAssessment()}
							disabled={openItem.isPending}
						>
							{openItem.isPending ? "Opening…" : "Start assessment"}
						</Button>
					</div>
				) : item.status === "in_assessment" ? (
					<AssessmentForm item={item} />
				) : canDecideApproval(item.status) ? (
					<PendingApprovalPanel item={item} canApprove={canApprove} />
				) : canOverride(item.status) && canApprove ? (
					<OverridePanel item={item} />
				) : null}

				{item.document ? (
					<IssuedDocumentPanel
						item={{ ...item, document: item.document }}
						canPrint={canPrint}
						canRevoke={canRevoke}
					/>
				) : needsIssuing(item) && canIssue ? (
					<IssueDocumentPanel
						item={item}
						allowExemption={allowsExemption(item.service.documentType)}
					/>
				) : null}

				{/* CRT-4: the application form and the Request for Payment, for Physical Examination. */}
				<PrintoutsPanel
					bookingId={item.booking.id}
					bookingItemId={item.bookingItemId}
					{...printoutsFor(item, canPrint)}
				/>

				<div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
					<h2 className="font-semibold">Assessment history</h2>
					{item.assessments.length === 0 ? (
						<p className="text-muted-foreground text-sm">No assessments yet.</p>
					) : (
						<ol className="flex flex-col gap-3">
							{item.assessments.map(assessment => {
								const corrections = Object.entries(assessment.corrections)
								return (
									<li key={assessment.id} className="flex flex-col gap-1 rounded-lg border p-3">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<Badge
												variant={assessment.outcome === "rejected" ? "destructive" : "secondary"}
											>
												{outcomeLabel(assessment.outcome, assessment.kind)}
											</Badge>
											<span className="text-muted-foreground text-xs">
												{assessment.staffName} · {dateTimeFormatter.format(assessment.createdAt)}
											</span>
										</div>
										{assessment.notes ? <p className="text-sm">{assessment.notes}</p> : null}
										{corrections.length > 0 ? (
											<ul className="text-muted-foreground text-xs">
												{corrections.map(([field, value]) => (
													<li key={field}>
														{field}: {value}
													</li>
												))}
											</ul>
										) : null}
									</li>
								)
							})}
						</ol>
					)}
				</div>
			</div>
		</div>
	)
}

function AssessmentForm({ item }: { item: ProcessingItem }) {
	const record = useRecordAssessmentMutation(item.bookingItemId)
	const [outcome, setOutcome] = useState<AssessmentOutcome>("cleared")
	const [notes, setNotes] = useState("")
	const [rows, setRows] = useState(() => [emptyRow()])
	const documentForm = useDocumentDetailsForm()
	// One key per decision, so a double click adds one Assessment, not two.
	const [idempotencyKey, setIdempotencyKey] = useState(newKey)

	const needsNote = outcome !== "cleared"
	const noteMissing = needsNote && notes.trim().length === 0
	const needsCertificate = outcome === "cleared" && issuesOnClear(item)
	// CRT-3: an exempt client gets a Medical Exemption Certificate instead.
	const allowExemption = allowsExemption(item.service.documentType)
	const exempt = needsCertificate && allowExemption && documentForm.mode === "exempt"
	const certificateMissing = needsCertificate && documentForm.missing
	// PRC-4: clearing waits for every required step's result. Return and reject do not.
	const stepsPending = outcome === "cleared" ? pendingRequiredSteps(item.steps ?? []) : []

	async function submit(event: React.FormEvent) {
		event.preventDefault()
		if (noteMissing || certificateMissing || stepsPending.length > 0) return
		try {
			const saved = await record.mutateAsync({
				outcome,
				notes: notes.trim(),
				corrections: correctionsFromRows(rows),
				document: needsCertificate && !exempt ? documentForm.details() : null,
				exemption: exempt ? documentForm.exemptionDetails() : null,
				idempotencyKey,
			})
			setIdempotencyKey(newKey())
			toast.success(
				saved.document
					? `Cleared. ${documentTypeLabel(saved.document.documentType)} ${saved.document.documentNumber} issued.`
					: `Assessment saved: ${itemStatusLabel(saved.status).toLowerCase()}`
			)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the assessment")
		}
	}

	return (
		<form
			onSubmit={event => void submit(event)}
			className="bg-card flex flex-col gap-4 rounded-xl border p-4"
		>
			{record.isPending ? (
				<BoqLoader label={needsCertificate ? "Issuing the certificate" : "Processing request"} />
			) : null}
			<h2 className="font-semibold">Record assessment</h2>

			<fieldset className="flex flex-col gap-2">
				<legend className="mb-2 text-sm font-medium">Decision</legend>
				<div className="grid gap-2 sm:grid-cols-3">
					{OUTCOMES.map(option => (
						<label
							key={option.value}
							className={cn(
								"flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors",
								outcome === option.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"
							)}
						>
							<span className="flex items-center gap-2 font-medium">
								<input
									type="radio"
									name="outcome"
									value={option.value}
									checked={outcome === option.value}
									onChange={() => setOutcome(option.value)}
								/>
								{option.label}
							</span>
							<span className="text-muted-foreground text-xs">{option.hint}</span>
						</label>
					))}
				</div>
				{outcome === "cleared" && item.service.requiresApproval ? (
					<p className="text-muted-foreground text-xs">
						This service needs head approval, so clearing sends it to the Head for approval first.
					</p>
				) : null}
				{stepsPending.length > 0 ? (
					<p role="alert" className="text-destructive text-sm">
						Record the result of every required step before clearing: {stepsPending.join(", ")}.
					</p>
				) : null}
			</fieldset>

			{needsCertificate ? (
				<DocumentDetailsFields
					form={documentForm}
					allowExemption={allowExemption}
					idPrefix="certificate"
					intro="Clearing this item issues the client's certificate at once."
				/>
			) : null}

			<div className="flex flex-col gap-2">
				<Label htmlFor="assessment-notes">
					Notes {needsNote ? "(required, the client will see why)" : "(optional)"}
				</Label>
				<Textarea
					id="assessment-notes"
					value={notes}
					onChange={event => setNotes(event.target.value)}
					maxLength={2000}
					rows={4}
					aria-invalid={noteMissing || undefined}
				/>
			</div>

			<fieldset className="flex flex-col gap-2">
				<legend className="mb-2 text-sm font-medium">Corrections (optional)</legend>
				{rows.map((row, index) => (
					<div key={row.id} className="flex gap-2">
						<Input
							aria-label={`Field ${index + 1}`}
							placeholder="Field, e.g. Birth date"
							value={row.field}
							maxLength={100}
							onChange={event =>
								setRows(current =>
									current.map(entry =>
										entry.id === row.id ? { ...entry, field: event.target.value } : entry
									)
								)
							}
						/>
						<Input
							aria-label={`Corrected value ${index + 1}`}
							placeholder="Corrected value"
							value={row.value}
							maxLength={500}
							onChange={event =>
								setRows(current =>
									current.map(entry =>
										entry.id === row.id ? { ...entry, value: event.target.value } : entry
									)
								)
							}
						/>
						<Button
							type="button"
							variant="ghost"
							onClick={() =>
								setRows(current =>
									current.length === 1 ? [emptyRow()] : current.filter(entry => entry.id !== row.id)
								)
							}
						>
							Remove
						</Button>
					</div>
				))}
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="self-start"
					onClick={() => setRows(current => [...current, emptyRow()])}
				>
					Add correction
				</Button>
			</fieldset>

			<Button
				type="submit"
				disabled={record.isPending || noteMissing || certificateMissing || stepsPending.length > 0}
				className="self-start"
			>
				{record.isPending
					? "Saving…"
					: exempt
						? "Clear and issue exemption certificate"
						: needsCertificate
							? "Clear and issue certificate"
							: "Save assessment"}
			</Button>
		</form>
	)
}
