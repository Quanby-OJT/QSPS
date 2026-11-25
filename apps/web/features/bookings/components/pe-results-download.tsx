"use client"

import { useEffect, useState } from "react"

import { env } from "@/env"

const API_BASE = `${env.NEXT_PUBLIC_API_BASE_URL}/${env.NEXT_PUBLIC_API_VERSION}`

export function PeResultsDownload({ itemId }: { itemId: number }) {
	const url = `${API_BASE}/bookings/items/${itemId}/pe-results`
	const [releasedUrl, setReleasedUrl] = useState<string | null>(null)

	useEffect(() => {
		const controller = new AbortController()
		void fetch(url, {
			credentials: "include",
			cache: "no-store",
			signal: controller.signal,
		})
			.then(async response => {
				if (!response.ok) return
				const result: unknown = await response.json()
				if (
					!controller.signal.aborted &&
					result &&
					typeof result === "object" &&
					"released" in result &&
					result.released === true
				) {
					setReleasedUrl(url)
				}
			})
			.catch(() => {})
		return () => controller.abort()
	}, [url])

	if (releasedUrl !== url) return null

	return (
		<a className="text-sm underline" href={`${url}/summary.pdf`}>
			Download Physical Examination results summary
		</a>
	)
}
