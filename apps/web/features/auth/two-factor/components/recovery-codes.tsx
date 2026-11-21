"use client"

import { useState } from "react"

import { Button } from "@/core/components/ui/button"

/**
 * Recovery codes, shown once (AUTH-2). Each code signs in one time when the
 * authenticator app is not available.
 */
export function RecoveryCodes({ codes }: { codes: readonly string[] }) {
	const [copied, setCopied] = useState(false)
	const text = codes.join("\n")

	async function copy() {
		try {
			await navigator.clipboard.writeText(text)
			setCopied(true)
		} catch {
			setCopied(false)
		}
	}

	function download() {
		const body = [
			"QSPS · Bureau of Quarantine: recovery codes",
			"Each code works once. Keep this file somewhere safe.",
			"",
			text,
			"",
		].join("\n")
		const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }))
		const link = document.createElement("a")
		link.href = url
		link.download = "qsps-recovery-codes.txt"
		link.click()
		URL.revokeObjectURL(url)
	}

	return (
		<div className="flex flex-col gap-3">
			<ul
				aria-label="Recovery codes"
				className="bg-muted grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-4 font-mono text-sm"
			>
				{codes.map(code => (
					<li key={code} className="tracking-wider">
						{code}
					</li>
				))}
			</ul>
			<div className="grid grid-cols-2 gap-2">
				<Button type="button" variant="outline" onClick={copy} className="hover:cursor-pointer">
					{copied ? "Copied" : "Copy codes"}
				</Button>
				<Button type="button" variant="outline" onClick={download} className="hover:cursor-pointer">
					Download .txt
				</Button>
			</div>
		</div>
	)
}
