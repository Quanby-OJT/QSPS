"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CustomerSupportIcon, Globe02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { ThemeToggle } from "@/core/components/theme-toggle"
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/core/components/ui/breadcrumb"
import { Separator } from "@/core/components/ui/separator"
import { SidebarTrigger } from "@/core/components/ui/sidebar"
import { getDashboardRouteTitle } from "@/features/dashboard/lib/nav-items"
import { env } from "@/env"

const HEADER_LINK =
	"text-muted-foreground hover:text-foreground hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium"

/**
 * Portal header: sidebar toggle, breadcrumb, Help and the official BOQ
 * website (ADM-8, TOR §IX), and the light/dark switch. On a phone the two
 * links show as icons only.
 */
export function SiteHeader() {
	const pathname = usePathname()
	const title = getDashboardRouteTitle(pathname)

	return (
		<header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
			<SidebarTrigger className="-ml-1" />
			<Separator orientation="vertical" className="h-4! self-center! mr-1" />
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem className="text-muted-foreground hidden sm:inline-flex">
						Workspace
					</BreadcrumbItem>
					<BreadcrumbSeparator className="hidden sm:block" />
					<BreadcrumbItem>
						<BreadcrumbPage className="font-medium">{title}</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
			<div className="ml-auto flex items-center gap-1">
				<Link href="/help" className={HEADER_LINK} aria-label="Help">
					<HugeiconsIcon icon={CustomerSupportIcon} strokeWidth={2} className="size-4" />
					<span className="hidden sm:inline" aria-hidden="true">
						Help
					</span>
				</Link>
				<a
					href={env.NEXT_PUBLIC_BOQ_WEBSITE_URL}
					target="_blank"
					rel="noopener noreferrer"
					className={HEADER_LINK}
					aria-label="Official BOQ website (opens in a new tab)"
				>
					<HugeiconsIcon icon={Globe02Icon} strokeWidth={2} className="size-4" />
					<span className="hidden md:inline" aria-hidden="true">
						BOQ website
					</span>
				</a>
				<ThemeToggle />
			</div>
		</header>
	)
}
