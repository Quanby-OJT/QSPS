import Image from "next/image"
import Link from "next/link"

import { ThemeToggle } from "@/core/components/theme-toggle"
import { linkButton } from "@/core/lib/link-button"
import { env } from "@/env"

/**
 * Header for the public pages (UI-1): the BOQ seal and name, the main links,
 * a light/dark switch, and Sign in / Book now, or Dashboard when already
 * signed in. One row on every screen: on a phone the name and the page links
 * are hidden, so the seal, the switch and the sign in buttons fit; Help and
 * the official BOQ website (ADM-8, TOR §IX) are in the footer there too.
 */
export function PublicHeader({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
	return (
		<header className="bg-background border-b">
			<div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:min-h-[76px] sm:gap-4 sm:px-6 sm:py-3 lg:px-8">
				<Link
					href="/"
					className="flex min-w-0 items-center gap-3"
					aria-label="Bureau of Quarantine home"
				>
					<Image
						src="/brand/boq.png"
						alt="Bureau of Quarantine seal"
						width={480}
						height={403}
						priority
						className="h-10 w-auto shrink-0 object-contain sm:h-11"
					/>
					<span className="hidden min-w-0 flex-col leading-tight min-[480px]:flex">
						<span className="truncate text-base font-extrabold tracking-tight">
							Bureau of Quarantine
						</span>
						<span className="text-muted-foreground hidden text-xs font-medium sm:inline">
							Quarantine Services and Payment System
						</span>
					</span>
				</Link>
				<nav
					aria-label="Main"
					className="flex shrink-0 items-center gap-x-3 text-sm font-semibold sm:gap-x-6"
				>
					<ThemeToggle />
					<Link href="/#services" className="hover:text-primary hidden md:inline">
						Services
					</Link>
					<Link href="/verify" className="hover:text-primary hidden md:inline">
						Verify a document
					</Link>
					<Link href="/help" className="hover:text-primary hidden md:inline">
						Help
					</Link>
					<a
						href={env.NEXT_PUBLIC_BOQ_WEBSITE_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-primary hidden lg:inline"
					>
						BOQ website
						<span className="sr-only"> (opens in a new tab)</span>
					</a>
					{isLoggedIn ? (
						<Link href="/dashboard" className={linkButton({ className: "max-sm:h-9 max-sm:px-3" })}>
							Dashboard
						</Link>
					) : (
						<>
							<Link href="/login" className="text-primary whitespace-nowrap hover:underline">
								Sign in
							</Link>
							<Link
								href="/register"
								className={linkButton({ className: "whitespace-nowrap max-sm:h-9 max-sm:px-3" })}
							>
								Book now
							</Link>
						</>
					)}
				</nav>
			</div>
		</header>
	)
}
