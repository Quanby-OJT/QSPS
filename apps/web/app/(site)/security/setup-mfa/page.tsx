import { redirect } from "next/navigation"

import { getSession } from "@/services/better-auth/auth-server"
import { MfaSetupFlow } from "@/features/auth/two-factor/components/mfa-setup-flow"

/** QSPS fields the session carries (see `user.additionalFields` in @repo/auth). */
type QspsSessionUser = {
	accountType?: string | null
	twoFactorEnabled?: boolean | null
	mustResetPassword?: boolean | null
}

/**
 * Two-factor enrolment (AUTH-2). Lives outside `(protected)` because that
 * layout sends staff without MFA here, and must not send them here twice.
 */
export default async function SetupMfaPage() {
	const session = await getSession()
	if (!session) {
		redirect("/login")
	}
	const user = session.user as QspsSessionUser
	// AUTH-3: a password that must be changed comes first.
	if (user.mustResetPassword) {
		redirect("/security/change-password")
	}
	if (user.twoFactorEnabled) {
		redirect("/dashboard")
	}

	return (
		<div className="bg-muted flex min-h-svh flex-col items-center justify-center p-6 md:p-10">
			<div className="w-full max-w-md">
				<MfaSetupFlow required={user.accountType === "staff"} />
			</div>
		</div>
	)
}