"use client"

import { useState } from "react"
import { toast } from "sonner"

import { env } from "@/env"
import { Button } from "@/core/components/ui/button"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

export function PeReleaseControls({ itemId }: { itemId: number }) {
	const [saving, setSaving] = useState(false)

	async function setRelease(released: boolean) {
		setSaving(true)
		try {
			const response = await fetch(`${API_BASE}/processing/items/${itemId}/pe-results/release`, {
				method: "PUT",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ released }),
			})
			if (!response.ok) {
				if (response.status === 403) {
					throw new Error("Only the authorized physician who recorded the evaluation can release the results.")
				}
				if (response.status === 409) {
					throw new Error("Complete Laboratory, X-ray, and Physician evaluation first.")
				}
				throw new Error("Could not update the results release.")
			}
			toast.success(released ? "Results released to the examinee." : "Results are no longer released.")
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not update the results release.")
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="flex flex-wrap gap-2">
			<Button type="button" disabled={saving} onClick={() => void setRelease(true)}>
				Release results to examinee
			</Button>
			<Button type="button" variant="outline" disabled={saving} onClick={() => void setRelease(false)}>
				Stop sharing results
			</Button>
		</div>
	)
}
