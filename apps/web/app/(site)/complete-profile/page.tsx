import { redirect } from "next/navigation"

import { getSession } from "@/services/better-auth/auth-server"
import { CompleteProfileForm } from "@/features/auth/complete-profile/components/complete-profile-form"
import { privacyNoticeRedirect } from "@/features/auth/privacy-notice/lib/privacy-notice"

/** QSPS fields the session carries (see `user.additionalFields` in @repo/auth). */
type QspsSessionUser = {
	profileCompletedAt?: string | Date | null
	privacyNoticeVersion?: string | null
}

/**
 * First-sign-in profile (AUTH-1). Lives outside `(protected)` because that
 * layout sends incomplete clients here, and must not send them here twice.
 */
export default async function CompleteProfilePage() {
	const session = await getSession()
	if (!session) {
		redirect("/login")
	}
	const user = session.user as QspsSessionUser
	if (user.profileCompletedAt) {
		redirect("/dashboard")
	}
	// PRC-2b: the Privacy Notice comes before the profile. Only clients reach
	// this page without a completed profile.
	const privacyNotice = privacyNoticeRedirect({
		isClient: true,
		privacyNoticeVersion: user.privacyNoticeVersion,
	})
	if (privacyNotice) {
		redirect(privacyNotice)
	}

	return (
		<div className="bg-muted flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
			<div className="w-full max-w-md">
				<CompleteProfileForm defaultName={session.user.name ?? ""} />
			</div>
		</div>
	)
}
