"use client"

import { useEffect, useState } from "react"

import { BoqLoader } from "@/core/components/boq-loader"
import { cn } from "@/core/lib/utils"

/** Never cover the page longer than this, even if something never finishes loading. */
const MAX_COVER_MS = 5_000
const FADE_MS = 300

function pageLoaded(): Promise<void> {
	if (document.readyState === "complete") return Promise.resolve()
	return new Promise(resolve => window.addEventListener("load", () => resolve(), { once: true }))
}

/**
 * The BOQ loader over the first page load (UI-1), like icv.boq.ph: on a slow
 * connection the page arrives before its fonts and scripts, and would show
 * half-built. The cover is in the server HTML, so it shows at once, then
 * fades out when the fonts and the page have loaded, after at most 5 s.
 * It lives in the root layout, so it runs once, not on every navigation.
 * A CSS animation hides it too, in case the scripts never run.
 */
export function FirstLoadCover() {
	const [phase, setPhase] = useState<"shown" | "fading" | "gone">("shown")

	useEffect(() => {
		let finished = false
		const finish = () => {
			if (finished) return
			finished = true
			setPhase("fading")
			window.setTimeout(() => setPhase("gone"), FADE_MS)
		}
		const timer = window.setTimeout(finish, MAX_COVER_MS)
		void Promise.all([document.fonts?.ready ?? Promise.resolve(), pageLoaded()]).then(finish)
		return () => window.clearTimeout(timer)
	}, [])

	if (phase === "gone") return null
	return (
		<BoqLoader
			label="Loading"
			className={cn(
				"first-load-cover bg-background z-[100] transition-opacity duration-300",
				phase === "fading" && "pointer-events-none opacity-0"
			)}
		/>
	)
}
