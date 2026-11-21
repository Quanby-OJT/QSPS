import Image from "next/image"

import { cn } from "@/core/lib/utils"

/**
 * BOQ's loading screen (UI-1), matching the official icv.boq.ph site: the
 * page fades behind a white veil, the BOQ seal pulses, and three dots run
 * under it with a short label. Covers the page while a request is running so
 * it is not clicked twice.
 */
export function BoqLoader({
	label = "Processing request",
	fullScreen = true,
	className,
}: {
	label?: string
	/** Cover the whole window (default), or only the nearest positioned parent. */
	fullScreen?: boolean
	className?: string
}) {
	return (
		<div
			role="status"
			aria-live="polite"
			className={cn(
				"bg-background/85 z-50 flex flex-col items-center justify-center gap-4 backdrop-blur-[2px]",
				fullScreen ? "fixed inset-0" : "absolute inset-0",
				className
			)}
		>
			<Image
				src="/brand/boq.png"
				alt=""
				width={480}
				height={403}
				priority
				className="h-24 w-auto object-contain motion-safe:animate-pulse"
			/>
			<div aria-hidden="true" className="flex items-center gap-1.5">
				<span className="bg-primary size-2 rounded-full motion-safe:animate-bounce motion-safe:[animation-delay:-0.3s]" />
				<span className="bg-primary size-2 rounded-full motion-safe:animate-bounce motion-safe:[animation-delay:-0.15s]" />
				<span className="bg-primary size-2 rounded-full motion-safe:animate-bounce" />
			</div>
			<p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
				{label}
			</p>
		</div>
	)
}
