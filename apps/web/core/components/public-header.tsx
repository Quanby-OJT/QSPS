import Image from "next/image"
import Link from "next/link"

import { ThemeToggle } from "@/core/components/theme-toggle"
import { linkButton } from "@/core/lib/link-button"

/**
 * Header for the public pages (UI-1): the BOQ seal and name, the main links,
 * a light/dark switch, and Sign in / Book now, or Dashboard when already
 * signed in.
 */
export function PublicHeader({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
	return (
		<header className="bg-background border-b">
			<div className="mx-auto flex min-h-[76px] max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
				<Link href="/" className="flex items-center gap-3">
					<Image
						src="/brand/boq.png"
						alt="Bureau of Quarantine seal"
						width={480}
						height={403}
						priority
						className="h-11 w-auto object-contain"
					/>
					<span className="flex flex-col leading-tight">
						<span className="text-base font-extrabold tracking-tight">Bureau of Quarantine</span>
						<span className="text-muted-foreground hidden text-xs font-medium sm:inline">
							Quarantine Services and Payment System
						</span>
					</span>
				</Link>
				<nav
					aria-label="Main"
					className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold"
				>
					<ThemeToggle />
					<Link href="/#services" className="hover:text-primary hidden md:inline">
						Services
					</Link>
					<Link href="/verify" className="hover:text-primary hidden md:inline">
						Verify a document
					</Link>
					{isLoggedIn ? (
						<Link href="/dashboard" className={linkButton()}>
							Go to dashboard
						</Link>
					) : (
						<>
							<Link href="/login" className="text-primary hover:underline">
								Sign in
							</Link>
							<Link href="/register" className={linkButton()}>
								Book now
							</Link>
						</>
					)}
				</nav>
			</div>
		</header>
	)
}
