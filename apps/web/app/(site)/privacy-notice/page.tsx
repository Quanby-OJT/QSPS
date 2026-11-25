import { redirect } from "next/navigation"

import { getSession } from "@/services/better-auth/auth-server"
import { PrivacyNoticeForm } from "@/features/auth/privacy-notice/components/privacy-notice-form"
import { privacyNoticeRedirect } from "@/features/auth/privacy-notice/lib/privacy-notice"
import { getAccess } from "@/features/dashboard/server/get-access"

/** QSPS fields the session carries (see `user.additionalFields` in @repo/auth). */
type QspsSessionUser = { privacyNoticeVersion?: string | null }

/**
 * PRC-2b: the Privacy Notice prompt at sign-in. Lives outside `(protected)`
 * because that layout sends clients here, and must not send them here twice.
 */
export default async function PrivacyNoticePage() {
	const session = await getSession()
	if (!session) {
		redirect("/login")
	}
	const access = await getAccess()
	const isClient = (access.roles as readonly string[]).includes("Client")
	if (
		!privacyNoticeRedirect({
			isClient,
			privacyNoticeVersion: (session.user as QspsSessionUser).privacyNoticeVersion,
		})
	) {
		redirect("/dashboard")
	}

	return (
		<div className="bg-muted flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
			<div className="w-full max-w-md">
				<PrivacyNoticeForm />
			</div>
		</div>
	)
}
