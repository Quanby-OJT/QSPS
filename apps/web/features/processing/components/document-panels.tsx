"use client"

import { useState } from "react"
import type { Route } from "next"
import Link from "next/link"
import { toast } from "sonner"

import type {
	BiologicalPermitDetails,
	HaccpDetails,
	IcvIssueDetails,
	MedicalExemptionDetails,
	ProcessingItem,
	SanitaryPermitDetails,
	ShipSanitationDetails,
} from "@repo/contracts"

import { BoqLoader } from "@/core/components/boq-loader"
import { Button, buttonVariants } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { Textarea } from "@/core/components/ui/textarea"
import { cn } from "@/core/lib/utils"
import {
	useIssueDocumentMutation,
	usePrintDocumentMutation,
	useReissueDocumentMutation,
	useRevokeDocumentMutation,
} from "@/features/processing/api/processing.hooks"
import {
	confirmationDocumentType,
	documentTypeLabel,
	isSeminarService,
	printCountLabel,
	usesStoredCertificateData,
	validityDocumentType,
	type ConfirmationDocumentType,
	type ValidityDocumentType,
} from "@/features/processing/lib/labels"
import { manilaDateKey } from "@/features/schedules/lib/calendar"

/** Same limit as MAX_EXEMPTION_REASON_LENGTH in @repo/contracts. */
const MAX_REASON_LENGTH = 500

/** Same limit as MAX_SHIP_FINDINGS_LENGTH in @repo/contracts. */
const MAX_FINDINGS_LENGTH = 1000

/** CRT-3: the client was vaccinated, or is medically exempt from the vaccine. */
export type DocumentMode = "vaccinated" | "exempt"

/**
 * What staff type for the document a cleared item gets: the vaccination
 * record's details (CRT-1), or the medical exemption (CRT-3). Shared by the
 * assessment form and the Issue document panel.
 */
export function useDocumentDetailsForm() {
	const today = manilaDateKey(new Date())
	const [mode, setMode] = useState<DocumentMode>("vaccinated")
	const [certificate, setCertificate] = useState({
		batchNumber: "",
		vaccinatorName: "",
		validFrom: today,
		validUntil: "",
		passportOrIdNumber: "",
	})
	const [exemption, setExemption] = useState({
		reason: "",
		physicianName: "",
		validFrom: today,
		validUntil: "",
		passportOrIdNumber: "",
	})

	const missing =
		mode === "vaccinated"
			? certificate.batchNumber.trim().length === 0 ||
				certificate.vaccinatorName.trim().length === 0 ||
				certificate.validFrom.length === 0
			: exemption.reason.trim().length === 0 ||
				exemption.physicianName.trim().length === 0 ||
				exemption.validFrom.length === 0

	function details(): IcvIssueDetails | null {
		if (mode !== "vaccinated") return null
		return {
			batchNumber: certificate.batchNumber.trim(),
			vaccinatorName: certificate.vaccinatorName.trim(),
			validFrom: certificate.validFrom,
			validUntil: certificate.validUntil || null,
			passportOrIdNumber: certificate.passportOrIdNumber.trim() || null,
		}
	}

	function exemptionDetails(): MedicalExemptionDetails | null {
		if (mode !== "exempt") return null
		return {
			reason: exemption.reason.trim(),
			physicianName: exemption.physicianName.trim(),
			validFrom: exemption.validFrom,
			validUntil: exemption.validUntil || null,
			passportOrIdNumber: exemption.passportOrIdNumber.trim() || null,
		}
	}

	return {
		mode,
		setMode,
		certificate,
		setCertificateField: (field: keyof typeof certificate, value: string) =>
			setCertificate(current => ({ ...current, [field]: value })),
		exemption,
		setExemptionField: (field: keyof typeof exemption, value: string) =>
			setExemption(current => ({ ...current, [field]: value })),
		missing,
		details,
		exemptionDetails,
	}
}

export type DocumentDetailsForm = ReturnType<typeof useDocumentDetailsForm>

/**
 * CRT-5, CRT-6: what staff type to issue a Sanitary Permit, a Ship Sanitation
 * Certificate or a HACCP Certificate: the validity period and, for a ship, the
 * inspection findings. The establishment or vessel details are not typed
 * again: they come from the client's application form.
 */
export function useSanitationForm() {
	const today = manilaDateKey(new Date())
	const [fields, setFields] = useState({ validFrom: today, validUntil: "", findings: "" })

	/** Both dates are required, and the document cannot end before it starts. */
	function missing(kind: ValidityDocumentType): boolean {
		return (
			fields.validFrom.length === 0 ||
			fields.validUntil.length === 0 ||
			fields.validUntil < fields.validFrom ||
			(kind === "ship-sanitation" && fields.findings.trim().length === 0)
		)
	}

	function sanitaryPermit(): SanitaryPermitDetails {
		return { validFrom: fields.validFrom, validUntil: fields.validUntil }
	}

	function haccp(): HaccpDetails {
		return { validFrom: fields.validFrom, validUntil: fields.validUntil }
	}

	function biologicalPermit(): BiologicalPermitDetails {
		return { validFrom: fields.validFrom, validUntil: fields.validUntil }
	}

	function shipSanitation(): ShipSanitationDetails {
		return {
			findings: fields.findings.trim(),
			validFrom: fields.validFrom,
			validUntil: fields.validUntil,
		}
	}

	return {
		fields,
		setField: (field: keyof typeof fields, value: string) =>
			setFields(current => ({ ...current, [field]: value })),
		missing,
		sanitaryPermit,
		shipSanitation,
		haccp,
		biologicalPermit,
	}
}

export type SanitationForm = ReturnType<typeof useSanitationForm>

const MODES: { value: DocumentMode; label: string; hint: string }[] = [
	{
		value: "vaccinated",
		label: "Vaccinated",
		hint: "Issue the vaccination certificate with the vaccine details.",
	},
	{
		value: "exempt",
		label: "Medically exempt",
		hint: "The vaccine was not given for a medical reason. Issue a Medical Exemption Certificate.",
	},
]

/**
 * The document fields (CRT-1, CRT-3). With `allowExemption`, staff first
 * choose Vaccinated or Medically exempt, and the fields follow the choice.
 */
export function DocumentDetailsFields({
	form,
	allowExemption,
	idPrefix,
	intro,
}: {
	form: DocumentDetailsForm
	allowExemption: boolean
	/** Keeps field ids unique when two forms could share a page. */
	idPrefix: string
	intro: string
}) {
	const { mode, certificate, exemption } = form
	const showExemption = allowExemption && mode === "exempt"

	return (
		<fieldset className="flex flex-col gap-3 rounded-lg border p-3">
			<legend className="px-1 text-sm font-medium">Certificate details</legend>
			<p className="text-muted-foreground text-xs">{intro} Fields marked * are required.</p>

			{allowExemption ? (
				<div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Vaccination">
					{MODES.map(option => (
						<label
							key={option.value}
							className={cn(
								"flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors",
								mode === option.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"
							)}
						>
							<span className="flex items-center gap-2 font-medium">
								<input
									type="radio"
									name={`${idPrefix}-mode`}
									value={option.value}
									checked={mode === option.value}
									onChange={() => form.setMode(option.value)}
								/>
								{option.label}
							</span>
							<span className="text-muted-foreground text-xs">{option.hint}</span>
						</label>
					))}
				</div>
			) : null}

			{showExemption ? (
				<div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
					<div className="flex flex-col gap-1.5 sm:col-span-2">
						<Label htmlFor={`${idPrefix}-reason`}>Medical reason *</Label>
						<Textarea
							id={`${idPrefix}-reason`}
							placeholder="e.g. Severe egg allergy (anaphylaxis)"
							value={exemption.reason}
							maxLength={MAX_REASON_LENGTH}
							rows={3}
							onChange={event => form.setExemptionField("reason", event.target.value)}
							aria-invalid={!exemption.reason.trim() || undefined}
						/>
					</div>
					<div className="flex flex-col gap-1.5 sm:col-span-2">
						<Label htmlFor={`${idPrefix}-physician`}>Examining physician *</Label>
						<Input
							id={`${idPrefix}-physician`}
							placeholder="e.g. Dr. Maria Santos"
							value={exemption.physicianName}
							maxLength={200}
							onChange={event => form.setExemptionField("physicianName", event.target.value)}
							aria-invalid={!exemption.physicianName.trim() || undefined}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${idPrefix}-exempt-from`}>Valid from *</Label>
						<Input
							id={`${idPrefix}-exempt-from`}
							type="date"
							value={exemption.validFrom}
							onChange={event => form.setExemptionField("validFrom", event.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${idPrefix}-exempt-until`}>Valid until</Label>
						<Input
							id={`${idPrefix}-exempt-until`}
							type="date"
							value={exemption.validUntil}
							min={exemption.validFrom || undefined}
							onChange={event => form.setExemptionField("validUntil", event.target.value)}
						/>
						<p className="text-muted-foreground text-xs">Leave blank if it has no end date.</p>
					</div>
					<div className="flex flex-col gap-1.5 sm:col-span-2">
						<Label htmlFor={`${idPrefix}-exempt-passport`}>Passport/ID number</Label>
						<Input
							id={`${idPrefix}-exempt-passport`}
							value={exemption.passportOrIdNumber}
							maxLength={50}
							onChange={event => form.setExemptionField("passportOrIdNumber", event.target.value)}
						/>
					</div>
				</div>
			) : (
				<div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${idPrefix}-batch`}>Batch/lot number *</Label>
						<Input
							id={`${idPrefix}-batch`}
							placeholder="e.g. YF-24A"
							value={certificate.batchNumber}
							maxLength={50}
							onChange={event => form.setCertificateField("batchNumber", event.target.value)}
							aria-invalid={!certificate.batchNumber.trim() || undefined}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${idPrefix}-vaccinator`}>Vaccinator *</Label>
						<Input
							id={`${idPrefix}-vaccinator`}
							placeholder="e.g. Dr. Juan Reyes"
							value={certificate.vaccinatorName}
							maxLength={200}
							onChange={event => form.setCertificateField("vaccinatorName", event.target.value)}
							aria-invalid={!certificate.vaccinatorName.trim() || undefined}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${idPrefix}-valid-from`}>Valid from *</Label>
						<Input
							id={`${idPrefix}-valid-from`}
							type="date"
							value={certificate.validFrom}
							onChange={event => form.setCertificateField("validFrom", event.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${idPrefix}-valid-until`}>Valid until</Label>
						<Input
							id={`${idPrefix}-valid-until`}
							type="date"
							value={certificate.validUntil}
							min={certificate.validFrom || undefined}
							onChange={event => form.setCertificateField("validUntil", event.target.value)}
						/>
						<p className="text-muted-foreground text-xs">Leave blank if it does not expire.</p>
					</div>
					<div className="flex flex-col gap-1.5 sm:col-span-2">
						<Label htmlFor={`${idPrefix}-passport`}>Passport/ID number</Label>
						<Input
							id={`${idPrefix}-passport`}
							value={certificate.passportOrIdNumber}
							maxLength={50}
							onChange={event => form.setCertificateField("passportOrIdNumber", event.target.value)}
						/>
					</div>
				</div>
			)}
		</fieldset>
	)
}

const VALIDITY_TITLES: Record<ValidityDocumentType, string> = {
	"sanitary-permit": "Sanitary Permit",
	"ship-sanitation": "Ship Sanitation Certificate",
	"haccp": "HACCP Certificate",
	"biological-permit": "Biological Substance Permit",
}

const VALIDITY_SOURCES: Record<ValidityDocumentType, string> = {
	"sanitary-permit": "The establishment details come from the client's application form.",
	"ship-sanitation": "The vessel details come from the client's application form.",
	"haccp": "The establishment details come from the client's application form.",
	"biological-permit":
		"The substance, quantity, origin and destination come from the client's application form.",
}

/**
 * The fields for a Sanitary Permit, a Ship Sanitation Certificate (CRT-5) or a
 * HACCP Certificate (CRT-6). The document is valid through its last day, then
 * the public verification page shows it as expired.
 */
export function SanitationFields({
	form,
	kind,
	idPrefix,
}: {
	form: SanitationForm
	kind: ValidityDocumentType
	idPrefix: string
}) {
	const { fields } = form
	const isShip = kind === "ship-sanitation"

	return (
		<fieldset className="flex flex-col gap-3 rounded-lg border p-3">
			<legend className="px-1 text-sm font-medium">{VALIDITY_TITLES[kind]}</legend>
			<p className="text-muted-foreground text-xs">
				{VALIDITY_SOURCES[kind]} Fields marked * are required.
			</p>
			<div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
				{isShip ? (
					<div className="flex flex-col gap-1.5 sm:col-span-2">
						<Label htmlFor={`${idPrefix}-findings`}>Inspection findings *</Label>
						<Textarea
							id={`${idPrefix}-findings`}
							placeholder="e.g. Galley, potable water and waste systems inspected; no infestation found."
							value={fields.findings}
							maxLength={MAX_FINDINGS_LENGTH}
							rows={4}
							onChange={event => form.setField("findings", event.target.value)}
							aria-invalid={!fields.findings.trim() || undefined}
						/>
					</div>
				) : null}
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${idPrefix}-san-from`}>Valid from *</Label>
					<Input
						id={`${idPrefix}-san-from`}
						type="date"
						value={fields.validFrom}
						onChange={event => form.setField("validFrom", event.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${idPrefix}-san-until`}>Valid until *</Label>
					<Input
						id={`${idPrefix}-san-until`}
						type="date"
						value={fields.validUntil}
						min={fields.validFrom || undefined}
						onChange={event => form.setField("validUntil", event.target.value)}
						aria-invalid={!fields.validUntil || undefined}
					/>
					<p className="text-muted-foreground text-xs">The last day it is valid.</p>
				</div>
			</div>
		</fieldset>
	)
}

const CONFIRMATION_SOURCES: Record<ConfirmationDocumentType, string> = {
	"human-remains":
		"The deceased, the consignee and the transport details come from the client's application form.",
	"biological-certification":
		"The substance, quantity, origin and destination come from the client's application form.",
}

/**
 * CRT-7: the Human Remains Certificate and the Biological Substance Certification
 * have nothing to type. Staff see where the details come from and issue.
 */
export function ConfirmationFields({ kind }: { kind: ConfirmationDocumentType }) {
	return (
		<fieldset className="flex flex-col gap-3 rounded-lg border p-3">
			<legend className="px-1 text-sm font-medium">{documentTypeLabel(kind)}</legend>
			<p className="text-muted-foreground text-xs">
				{CONFIRMATION_SOURCES[kind]} There is nothing to enter here. The details are stored
				encrypted.
			</p>
		</fieldset>
	)
}

/**
 * The item's issued document (CRT-1), with its type, how often it was
 * printed, and, for staff with `certificates.documents:print`, a Print
 * button (CRT-3). The vaccination record prints on the yellow card.
 */
export function IssuedDocumentPanel({
	item,
	canPrint,
	canRevoke = false,
}: {
	item: ProcessingItem & { document: NonNullable<ProcessingItem["document"]> }
	canPrint: boolean
	/** CRT-8: the caller holds certificates.documents:revoke. */
	canRevoke?: boolean
}) {
	const print = usePrintDocumentMutation(item.bookingItemId)
	const { document } = item
	const onCard = document.documentType === "icv-record"

	async function printDocument() {
		// Opened from the click itself, or the browser blocks the new tab.
		const target = window.open("", "_blank")
		try {
			const { printCount } = await print.mutateAsync({ documentId: document.id, target })
			toast.success(
				printCount > 1
					? `Reprint ${printCount - 1} sent to the print view`
					: "Print view opened. Load the card and print."
			)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not print the document")
		}
	}

	return (
		<div className="bg-card flex flex-col gap-2 rounded-xl border p-4">
			<h2 className="font-semibold">Document issued</h2>
			<p className="text-sm">{documentTypeLabel(document.documentType)}</p>
			<p className="text-sm">
				<span className="font-mono">{document.documentNumber}</span>
			</p>
			<p className="text-muted-foreground text-xs">
				{printCountLabel(document.printCount)} · The client can download it from My Documents.
			</p>
			{canPrint ? (
				<div className="flex flex-col items-start gap-1 pt-1">
					<Button type="button" onClick={() => void printDocument()} disabled={print.isPending}>
						{print.isPending
							? "Preparing…"
							: document.printCount > 0
								? onCard
									? "Reprint card"
									: "Reprint"
								: onCard
									? "Print card"
									: "Print"}
					</Button>
					<p className="text-muted-foreground text-xs">
						{onCard
							? "Prints onto the pre-printed yellow card, using this office's card offsets. Print at 100% (actual size)."
							: "Prints on plain A4 paper."}{" "}
						Every print is recorded.
					</p>
				</div>
			) : null}
			{canRevoke ? <DocumentStatusActions item={item} /> : null}
		</div>
	)
}

function newKey(): string {
	return crypto.randomUUID()
}

/**
 * Issue the document for a cleared item that has none yet (CRT-1, CRT-3,
 * CRT-5): Services with auto-issue off, or items cleared after head approval.
 * Staff enter the vaccination details, record the medical exemption, or, for
 * a sanitation Service, the validity period of the permit or certificate.
 */
export function IssueDocumentPanel({
	item,
	allowExemption,
}: {
	item: ProcessingItem
	allowExemption: boolean
}) {
	const issue = useIssueDocumentMutation(item.bookingItemId)
	const form = useDocumentDetailsForm()
	const sanitationForm = useSanitationForm()
	// CRT-5, CRT-6: these Services issue a permit or a certificate with a validity period, not the vaccination record.
	const sanitation = validityDocumentType(item.service.documentType)
	// CRT-7: human remains and biological certification Services issue from the answers, with nothing typed.
	const confirmation = confirmationDocumentType(item.service.documentType)
	// One key per issue, so a double click issues one document, not two.
	const [idempotencyKey, setIdempotencyKey] = useState(newKey)
	const usesStoredData = usesStoredCertificateData(item.service.documentType)
	const usesPeResults = item.service.documentType === "pe-medical-certificate"
	const exempt =
		!usesPeResults &&
		!usesStoredData &&
		!sanitation &&
		!confirmation &&
		allowExemption &&
		form.mode === "exempt"
	const missing =
		usesPeResults || usesStoredData
			? false
			: sanitation
				? sanitationForm.missing(sanitation)
				: confirmation
					? false
					: form.missing

	async function submit(event: React.FormEvent) {
		event.preventDefault()
		if (missing) return
		try {
			const document = await issue.mutateAsync({
				details:
					usesPeResults || usesStoredData || sanitation || confirmation || exempt
						? null
						: form.details(),
				exemption: exempt ? form.exemptionDetails() : null,
				sanitaryPermit: sanitation === "sanitary-permit" ? sanitationForm.sanitaryPermit() : null,
				shipSanitation: sanitation === "ship-sanitation" ? sanitationForm.shipSanitation() : null,
				haccp: sanitation === "haccp" ? sanitationForm.haccp() : null,
				humanRemains: confirmation === "human-remains" ? {} : null,
				biologicalCertification: confirmation === "biological-certification" ? {} : null,
				biologicalPermit:
					sanitation === "biological-permit" ? sanitationForm.biologicalPermit() : null,
				idempotencyKey,
			})
			setIdempotencyKey(newKey())
			toast.success(`Document ${document.documentNumber} issued`)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not issue the document")
		}
	}

	// CRT-6: a seminar attendee is issued from the session roster, with everyone else.
	if (isSeminarService(item.service.documentType)) {
		return (
			<div className="bg-card flex flex-col gap-3 rounded-xl border p-4">
				<h2 className="font-semibold">Issue document</h2>
				<p className="text-muted-foreground text-sm">
					Food Safety Training Certificates are issued from the seminar session, together with the
					other attendees who are marked present.
				</p>
				<Link
					href={"/seminars" as Route}
					className={cn(buttonVariants({ variant: "outline" }), "self-start")}
				>
					Open seminar sessions
				</Link>
			</div>
		)
	}

	return (
		<form
			onSubmit={event => void submit(event)}
			className="bg-card flex flex-col gap-4 rounded-xl border p-4"
		>
			{issue.isPending ? <BoqLoader label="Issuing the certificate" /> : null}
			<h2 className="font-semibold">Issue document</h2>
			{usesPeResults || usesStoredData ? (
				<p className="text-muted-foreground text-sm">
					{usesPeResults
						? "This certificate uses the recorded Physician evaluation."
						: "This certificate uses the information already recorded on the booking item."}
				</p>
			) : sanitation ? (
				<SanitationFields form={sanitationForm} kind={sanitation} idPrefix="issue" />
			) : confirmation ? (
				<ConfirmationFields kind={confirmation} />
			) : (
				<DocumentDetailsFields
					form={form}
					allowExemption={allowExemption}
					idPrefix="issue"
					intro="This item is cleared but has no document yet."
				/>
			)}
			<Button type="submit" disabled={issue.isPending || missing} className="self-start">
				{issue.isPending
					? "Issuing…"
					: sanitation
						? sanitation === "haccp"
							? "Issue HACCP certificate"
							: `Issue ${documentTypeLabel(sanitation).toLowerCase()}`
						: confirmation
							? `Issue ${documentTypeLabel(confirmation).toLowerCase()}`
							: exempt
								? "Issue exemption certificate"
								: "Issue certificate"}
			</Button>
		</form>
	)
}

/**
 * CRT-8: withdraw the document, or replace it with a corrected one. Shown to
 * staff with certificates.documents:revoke; the API checks the key and the
 * Scope on every call. A reason is always required and is kept in the audit.
 */
function DocumentStatusActions({
	item,
}: {
	item: ProcessingItem & { document: NonNullable<ProcessingItem["document"]> }
}) {
	const revoke = useRevokeDocumentMutation(item.bookingItemId)
	const reissue = useReissueDocumentMutation(item.bookingItemId)
	const form = useDocumentDetailsForm()
	const [action, setAction] = useState<"none" | "revoke" | "reissue">("none")
	const [reason, setReason] = useState("")
	const { document } = item
	const exemptionDocument = document.documentType === "medical-exemption"
	// Only the vaccination record and the exemption can be reissued so far (CRT-8); the
	// sanitation and food safety documents can still be revoked.
	const canReissue = document.documentType === "icv-record" || exemptionDocument
	const busy = revoke.isPending || reissue.isPending

	function close() {
		setAction("none")
		setReason("")
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault()
		const trimmed = reason.trim()
		if (!trimmed) return
		try {
			if (action === "revoke") {
				await revoke.mutateAsync({ documentId: document.id, reason: trimmed })
				toast.success(`Document ${document.documentNumber} revoked`)
			} else {
				if (form.missing) return
				const replacement = await reissue.mutateAsync({
					documentId: document.id,
					reason: trimmed,
					details: exemptionDocument ? null : form.details(),
					exemption: exemptionDocument ? form.exemptionDetails() : null,
				})
				toast.success(`Reissued as ${replacement.documentNumber}`)
			}
			close()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not change the document")
		}
	}

	if (action === "none") {
		return (
			<div className="flex flex-wrap gap-2 border-t pt-3">
				{canReissue ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							form.setMode(exemptionDocument ? "exempt" : "vaccinated")
							setAction("reissue")
						}}
					>
						Reissue with corrections
					</Button>
				) : null}
				<Button type="button" variant="destructive" onClick={() => setAction("revoke")}>
					Revoke
				</Button>
			</div>
		)
	}

	return (
		<form onSubmit={event => void submit(event)} className="flex flex-col gap-3 border-t pt-3">
			<h3 className="text-sm font-medium">
				{action === "revoke" ? "Revoke this document" : "Reissue a corrected document"}
			</h3>
			<p className="text-muted-foreground text-xs">
				{action === "revoke"
					? "It stops being valid at once and the verification page says so. It stays on record, and the client is told."
					: "This document becomes superseded. A new one with a new number and QR code replaces it, and the client is told."}
			</p>
			{action === "reissue" ? (
				<DocumentDetailsFields
					form={form}
					allowExemption={exemptionDocument}
					idPrefix="reissue"
					intro="Enter the corrected details. The client's name and details come from their profile."
				/>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="document-status-reason">Reason *</Label>
				<Textarea
					id="document-status-reason"
					value={reason}
					maxLength={MAX_REASON_LENGTH}
					rows={2}
					onChange={event => setReason(event.target.value)}
				/>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					variant={action === "revoke" ? "destructive" : "default"}
					disabled={busy || !reason.trim() || (action === "reissue" && form.missing)}
				>
					{busy ? "Saving…" : action === "revoke" ? "Revoke document" : "Reissue document"}
				</Button>
				<Button type="button" variant="ghost" disabled={busy} onClick={close}>
					Cancel
				</Button>
			</div>
		</form>
	)
}
