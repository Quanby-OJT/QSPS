import type { Metadata } from "next"

import { AnalyticsIdentityStamp } from "@/services/analytics/analytics-identity-stamp"
import { LoginForm } from "@/features/auth/login/components/login-form"

/**
 * Staff sign-in (AUTH-3, TOR §II / COA Circular 2021-014: a separate, hidden
 * sign-in page for personnel). No page links here, and it is left out of the
 * sitemap and of robots.txt; listing it there, even as Disallow, would publish
 * the address. Search engines are told not to index it.
 */
export const metadata: Metadata = {
	title: "Staff sign in",
	robots: { index: false, follow: false, nocache: true },
}

export default function StaffSignInPage() {
	return (
		<section className="flex flex-1 flex-col items-center justify-center">
			{/* Signed out: clears a previous user's PostHog identity. */}
			<AnalyticsIdentityStamp userId={null} />
			<LoginForm className="w-full" variant="staff" />
		</section>
	)
}