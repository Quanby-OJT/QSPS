import { redirect } from "next/navigation"

import { getSession } from "@/services/better-auth/auth-server"
import { SecuritySettings } from "@/features/auth/two-factor/components/security-settings"

/** QSPS fields the session carries (see `user.additionalFields` in @repo/auth). */
type QspsSessionUser = { accountType?: string | null; twoFactorEnabled?: boolean | null }

/** Sign-in security settings (AUTH-2). */
export default async function SecuritySettingsPage() {
	const session = await getSession()
	if (!session) {
		redirect("/login")
	}
	const user = session.user as QspsSessionUser

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1.5">
				<span aria-hidden="true" className="bg-gold h-[3px] w-10" />
				<h1 className="text-2xl font-extrabold tracking-tight">Security</h1>
				<p className="text-muted-foreground">How you sign in to QSPS.</p>
			</div>
			<SecuritySettings
				enabled={user.twoFactorEnabled === true}
				isStaff={user.accountType === "staff"}
			/>
		</div>
	)
}
