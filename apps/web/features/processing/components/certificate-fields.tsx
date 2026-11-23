"use client"

import type { IcvIssueDetails, ProcessingItem } from "@repo/contracts"

import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { manilaDateKey } from "@/features/schedules/lib/calendar"

/** The certificate details as typed, before they are sent. */
export interface CertificateDraft {
	batchNumber: string
	vaccinatorName: string
	validFrom: string
	validUntil: string
	passportOrIdNumber: string
}

export function emptyCertificate(): CertificateDraft {
	return {
		batchNumber: "",
		vaccinatorName: "",
		validFrom: manilaDateKey(new Date()),
		validUntil: "",
		passportOrIdNumber: "",
	}
}

/** The required fields are filled in. */
export function isCertificateComplete(draft: CertificateDraft): boolean {
	return (
		draft.batchNumber.trim().length > 0 &&
		draft.vaccinatorName.trim().length > 0 &&
		draft.validFrom.length > 0
	)
}

export function toIssueDetails(draft: CertificateDraft): IcvIssueDetails {
	return {
		batchNumber: draft.batchNumber.trim(),
		vaccinatorName: draft.vaccinatorName.trim(),
		validFrom: draft.validFrom,
		validUntil: draft.validUntil || null,
		passportOrIdNumber: draft.passportOrIdNumber.trim() || null,
	}
}

/**
 * Whether making this item cleared issues its document at once (CRT-1,
 * CRT-1a): the Service auto-issues and has a document type. The officer's
 * Clear only does so when no head approval is needed; an approval or an
 * override always does.
 */
export function issuesDocument(item: ProcessingItem): boolean {
	return item.service.autoIssue && item.service.documentType !== null
}

/**
 * The certificate details staff enter when their action issues the client's
 * vaccination certificate: on Clear (CRT-1), on head approval or on override
 * (CRT-1a).
 */
export function CertificateFields({
	value,
	onChange,
	description,
	idPrefix = "certificate",
}: {
	value: CertificateDraft
	onChange: (field: keyof CertificateDraft, value: string) => void
	description: string
	idPrefix?: string
}) {
	return (
		<fieldset className="flex flex-col gap-3 rounded-lg border p-3">
			<legend className="px-1 text-sm font-medium">Certificate details</legend>
			<p className="text-muted-foreground text-xs">{description} Fields marked * are required.</p>
			<div className="grid items-start gap-x-3 gap-y-4 sm:grid-cols-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${idPrefix}-batch`}>Batch/lot number *</Label>
					<Input
						id={`${idPrefix}-batch`}
						placeholder="e.g. YF-24A"
						value={value.batchNumber}
						maxLength={50}
						onChange={event => onChange("batchNumber", event.target.value)}
						aria-invalid={!value.batchNumber.trim() || undefined}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${idPrefix}-vaccinator`}>Vaccinator *</Label>
					<Input
						id={`${idPrefix}-vaccinator`}
						placeholder="e.g. Dr. Juan Reyes"
						value={value.vaccinatorName}
						maxLength={200}
						onChange={event => onChange("vaccinatorName", event.target.value)}
						aria-invalid={!value.vaccinatorName.trim() || undefined}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${idPrefix}-valid-from`}>Valid from *</Label>
					<Input
						id={`${idPrefix}-valid-from`}
						type="date"
						value={value.validFrom}
						onChange={event => onChange("validFrom", event.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={`${idPrefix}-valid-until`}>Valid until</Label>
					<Input
						id={`${idPrefix}-valid-until`}
						type="date"
						value={value.validUntil}
						min={value.validFrom || undefined}
						onChange={event => onChange("validUntil", event.target.value)}
					/>
					<p className="text-muted-foreground text-xs">Leave blank if it does not expire.</p>
				</div>
				<div className="flex flex-col gap-1.5 sm:col-span-2">
					<Label htmlFor={`${idPrefix}-passport`}>Passport/ID number</Label>
					<Input
						id={`${idPrefix}-passport`}
						value={value.passportOrIdNumber}
						maxLength={50}
						onChange={event => onChange("passportOrIdNumber", event.target.value)}
					/>
				</div>
			</div>
		</fieldset>
	)
}
