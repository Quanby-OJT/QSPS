import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getSession } from "@/services/better-auth/auth-server"
import { ChangePasswordForm } from "@/features/auth/change-password/components/change-password-form"

export const metadata: Metadata = {
	title: "Set a new password",
	robots: { index: false, follow: false },
}

/** QSPS fields the session carries (see `user.additionalFields` in @repo/auth). */
type QspsSessionUser = { mustResetPassword?: boolean | null }

/**
 * Forced password change (AUTH-3). Lives outside `(protected)` because that
 * layout sends accounts that must change their password here, and must not
 * send them here twice.
 */
export default async function ChangePasswordPage() {
	const session = await getSession()
	if (!session) {
		redirect("/login")
	}
	if (!(session.user as QspsSessionUser).mustResetPassword) {
		redirect("/dashboard")
	}

	return (
		<div className="bg-muted flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
			<div className="w-full max-w-md">
				<ChangePasswordForm />
			</div>
		</div>
	)
}