"use client"

import { usePathname, useRouter } from "next/navigation"

import { Dialog, DialogContent, DialogTitle } from "@/core/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle } from "@/core/components/ui/sheet"
import { useIsMobile } from "@/core/hooks/use-mobile"

export type AuthModalRoute = "/login" | "/register" | "/forgot-password"

/**
 * Sign in, register and forgot password over the home page (UI-1), like
 * icv.boq.ph. On a phone the form slides up from the bottom; on a larger
 * screen it slides up into a centered box. The address still changes to the
 * page's own route, so the back button closes it and a shared link opens the
 * full page.
 *
 * Open only while the address is this panel's own route: after signing in,
 * the app goes to "/", and the panel closes by itself.
 */
export function AuthModal({
	route,
	title,
	children,
}: {
	route: AuthModalRoute
	/** For screen readers; the form shows its own heading. */
	title: string
	children: React.ReactNode
}) {
	const router = useRouter()
	const pathname = usePathname()
	const isMobile = useIsMobile()

	const open = pathname === route
	const onOpenChange = (next: boolean) => {
		if (!next) router.back()
	}

	if (isMobile) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="bottom"
					className="max-h-[92svh] overflow-y-auto rounded-t-3xl px-4 pt-3 pb-6"
				>
					<div
						aria-hidden="true"
						className="bg-muted-foreground/30 mx-auto h-1.5 w-12 rounded-full"
					/>
					<SheetTitle className="sr-only">{title}</SheetTitle>
					{children}
				</SheetContent>
			</Sheet>
		)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="data-open:slide-in-from-bottom-8 data-closed:slide-out-to-bottom-8 max-h-[90svh] overflow-y-auto rounded-3xl p-2 duration-300 sm:max-w-lg">
				<DialogTitle className="sr-only">{title}</DialogTitle>
				{children}
			</DialogContent>
		</Dialog>
	)
}
