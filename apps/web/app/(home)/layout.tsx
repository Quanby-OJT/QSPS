import { CacheIdentity } from "@/services/tanstack-query/cache-identity"

/**
 * Public home (UI-1). Full width, so the home page can run its sections edge
 * to edge; each section sets its own max width. `modal` is the sign in or
 * register panel that slides up over the page (@modal).
 */
export default function HomeLayout({
	children,
	modal,
}: Readonly<{
	children: React.ReactNode
	modal: React.ReactNode
}>) {
	return (
		<div className="flex min-h-svh flex-col">
			{/* Scope the persisted cache to this user before anything reads it.
			    Both routes under this layout already resolve a session of their own,
			    so this adds no request and costs no static route. */}
			<CacheIdentity />
			{children}
			{modal}
		</div>
	)
}
