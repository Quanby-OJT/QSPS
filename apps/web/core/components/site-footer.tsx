import Image from "next/image"
import Link from "next/link"

import { cn } from "@/core/lib/utils"
import { env } from "@/env"

/**
 * Partner seals, in the order BOQ shows them (UI-1). Official marks: used
 * as supplied, unaltered. Sizes are the files' own, so the browser keeps the
 * aspect ratio; the height is set in CSS.
 */
const SEALS = [
	{ src: "/brand/who.png", alt: "World Health Organization", width: 480, height: 423 },
	{ src: "/brand/ph.png", alt: "Republic of the Philippines", width: 330, height: 366 },
	{ src: "/brand/doh.png", alt: "Department of Health", width: 480, height: 480 },
	{ src: "/brand/boq.png", alt: "Bureau of Quarantine", width: 480, height: 403 },
] as const

const LINKS = [
	{ href: "/verify", label: "Verify a document" },
	{ href: "/help", label: "Help" },
	{ href: "/terms", label: "Terms and policies" },
] as const

/**
 * Footer on every QSPS page (UI-1): the WHO, Philippine government, DOH and
 * BOQ seals, then the copyright line. The year follows the clock so it
 * never goes stale. The links include Help (ADM-8), the booking terms
 * (ADM-9) and the official BOQ website (TOR §IX), on the public site and in
 * both portals.
 */
export function SiteFooter({ className }: { className?: string }) {
	const year = new Date().getFullYear()

	return (
		<footer className={cn("bg-background border-t", className)}>
			<div aria-hidden="true" className="bg-gold h-[3px]" />
			<div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-10 sm:px-6 lg:px-8">
				<ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-6 sm:gap-x-10">
					{SEALS.map(seal => (
						<li key={seal.src}>
							<Image
								src={seal.src}
								alt={seal.alt}
								width={seal.width}
								height={seal.height}
								className="h-12 w-auto object-contain sm:h-20"
							/>
						</li>
					))}
				</ul>
				<div className="flex flex-col items-center gap-1 text-center">
					<p className="text-primary text-base font-semibold tracking-wide sm:text-lg">
						© {year} BUREAU OF QUARANTINE
					</p>
					<p className="text-muted-foreground text-xs font-semibold tracking-[0.12em]">
						ALL RIGHTS RESERVED
					</p>
				</div>
				<nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
					{LINKS.map(link => (
						<Link
							key={link.href}
							href={link.href}
							className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
						>
							{link.label}
						</Link>
					))}
					<a
						href={env.NEXT_PUBLIC_BOQ_WEBSITE_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
					>
						Official BOQ website
						<span className="sr-only"> (opens in a new tab)</span>
					</a>
				</nav>
			</div>
		</footer>
	)
}
