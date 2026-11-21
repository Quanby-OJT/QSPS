"use client"

import { useState } from "react"

import {
	ManualVerificationSchema,
	VERIFICATION_CODE_LENGTH,
	type ManualVerificationInput,
} from "@repo/contracts"

import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { useManualVerificationQuery } from "@/features/certificates/api/verification.hooks"
import {
	verificationCard,
	VerificationShell,
} from "@/features/certificates/components/document-verification"
import { VerificationResult } from "@/features/certificates/components/verification-result"

/**
 * Manual entry on the public portal (CRT-2), for someone without a QR
 * scanner: the Document Number plus the code printed under the QR code.
 */
export function ManualVerification() {
	const [documentNumber, setDocumentNumber] = useState("")
	const [code, setCode] = useState("")
	const [formError, setFormError] = useState<string | null>(null)
	const [submitted, setSubmitted] = useState<ManualVerificationInput | null>(null)
	const result = useManualVerificationQuery(submitted)

	function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const parsed = ManualVerificationSchema.safeParse({ documentNumber, code })
		if (!parsed.success) {
			setFormError(parsed.error.issues[0]?.message ?? "Check the details and try again")
			return
		}
		setFormError(null)
		setSubmitted(parsed.data)
	}

	return (
		<VerificationShell
			description={
				<>
					Scan the QR code on the document, or enter its document number and the{" "}
					{VERIFICATION_CODE_LENGTH}-character code printed under the QR code.
				</>
			}
		>
			<form onSubmit={submit} className={verificationCard} noValidate>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="verify-number">Document number</Label>
					<Input
						id="verify-number"
						placeholder="e.g. ICV-MNL-2026-000001"
						value={documentNumber}
						maxLength={100}
						autoComplete="off"
						onChange={event => setDocumentNumber(event.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="verify-code">Code under the QR code</Label>
					<Input
						id="verify-code"
						className="font-mono"
						placeholder="e.g. aB3x_9Qz"
						value={code}
						maxLength={VERIFICATION_CODE_LENGTH}
						autoComplete="off"
						autoCapitalize="off"
						spellCheck={false}
						onChange={event => setCode(event.target.value)}
					/>
					<p className="text-muted-foreground text-xs">Capital and small letters matter.</p>
				</div>
				{formError ? (
					<p role="alert" className="text-destructive text-sm">
						{formError}
					</p>
				) : null}
				<Button type="submit" size="lg" className="w-full" disabled={result.isFetching}>
					{result.isFetching ? "Checking…" : "Verify document"}
				</Button>
			</form>

			{submitted ? (
				<div className={verificationCard} role="status">
					<VerificationResult
						isPending={result.isPending}
						error={result.error}
						data={result.data}
					/>
				</div>
			) : null}
		</VerificationShell>
	)
}
