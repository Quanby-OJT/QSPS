"use client"

import { useState } from "react"

import { Button } from "@/core/components/ui/button"
import { Card, CardContent } from "@/core/components/ui/card"

import { useAcceptPrivacyNoticeMutation } from "../api/privacy-notice.hooks"
import { PRIVACY_NOTICE_TEXT } from "../lib/privacy-notice"

/**
 * PRC-2b: shown at sign-in to a client who has not accepted the current
 * Privacy Notice (no record, or an older version). The portal stays closed
 * until they accept.
 */
export function PrivacyNoticeForm() {
	const [accepted, setAccepted] = useState(false)
	const { mutate: accept, isPending, isError, error } = useAcceptPrivacyNoticeMutation()

	return (
		<Card>
			<CardContent className="flex flex-col gap-6 p-6 md:p-8">
				<div className="flex flex-col items-center gap-2 text-center">
					<h1 className="text-2xl font-bold">Privacy Notice</h1>
					<p className="text-muted-foreground text-balance">
						Please read and accept the Privacy Notice before you continue.
					</p>
				</div>

				{isError ? (
					<div
						className="bg-destructive/10 text-destructive dark:bg-destructive/20 rounded-lg p-3 text-sm"
						role="alert"
					>
						{error instanceof Error ? error.message : "An unexpected error occurred"}
					</div>
				) : null}

				<p id="privacy-notice-text" className="bg-muted rounded-lg p-3 text-sm leading-relaxed">
					{PRIVACY_NOTICE_TEXT}
				</p>

				<div className="flex items-start gap-3">
					<input
						id="privacy-notice-accepted"
						type="checkbox"
						className="accent-primary mt-1 size-4 shrink-0"
						checked={accepted}
						onChange={event => setAccepted(event.target.checked)}
						aria-describedby="privacy-notice-text"
						disabled={isPending}
					/>
					<label htmlFor="privacy-notice-accepted" className="text-sm leading-snug">
						I have read and accept the Privacy Notice.
					</label>
				</div>

				<Button
					type="button"
					className="w-full hover:cursor-pointer"
					disabled={!accepted || isPending}
					onClick={() => accept()}
				>
					{isPending ? "Saving..." : "Accept and continue"}
				</Button>
			</CardContent>
		</Card>
	)
}
