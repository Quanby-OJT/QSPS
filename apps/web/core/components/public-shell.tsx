import { PublicHeader } from "@/core/components/public-header"
import { SiteFooter } from "@/core/components/site-footer"

/**
 * The public page frame (UI-1): BOQ header, a centered column on a light
 * band, and the seals footer. Used by the pages anyone can open without
 * signing in, such as document and e-Receipt verification.
 */
export function PublicShell({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-svh flex-col">
			<PublicHeader />
			<main className="bg-muted/40 flex-1">
				<div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">{children}</div>
			</main>
			<SiteFooter />
		</div>
	)
}
