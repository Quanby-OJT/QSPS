import { redirect } from "next/navigation"

import { SiteFooter } from "@/core/components/site-footer"
import { SidebarInset, SidebarProvider } from "@/core/components/ui/sidebar"
import { getSession } from "@/services/better-auth/auth-server"
import { CacheIdentity } from "@/services/tanstack-query/cache-identity"
import { privacyNoticeRedirect } from "@/features/auth/privacy-notice/lib/privacy-notice"
import { AppSidebar } from "@/features/dashboard/components/app-sidebar"
import { SiteHeader } from "@/features/dashboard/components/site-header"
import { getAccess } from "@/features/dashboard/server/get-access"

/** QSPS fields the session carries (see `user.additionalFields` in @repo/auth). */
type QspsSessionUser = {
	profileCompletedAt?: string | Date | null
	accountType?: string | null
	twoFactorEnabled?: boolean | null
	mustResetPassword?: boolean | null
	privacyNoticeVersion?: string | null
}

/** AUTH-2: where a staff account sets up two-factor authentication. */
const MFA_SETUP_PATH = "/security/setup-mfa"

/** AUTH-3: where an account that must set a new password does so. */
const CHANGE_PASSWORD_PATH = "/security/change-password"

export default async function SiteLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	// A failed read throws. The parent segment renders an error, not /login.
	const session = await getSession()

	if (!session) {
		redirect("/login")
	}

	const qspsUser = session.user as QspsSessionUser

	// AUTH-3: a staff password past the rotation Policy (or any account flagged
	// to set a new password) is changed first. The backend refuses this
	// account's API calls until then, so it is checked before `getAccess`.
	if (qspsUser.mustResetPassword === true) {
		redirect(CHANGE_PASSWORD_PATH)
	}

	// AUTH-2: MFA is mandatory for staff. A staff account without it goes to
	// enrolment before any other screen. Checked before `getAccess`, because
	// the backend refuses that staff account's API calls until it enrols.
	if (qspsUser.accountType === "staff" && qspsUser.twoFactorEnabled !== true) {
		redirect(MFA_SETUP_PATH)
	}

	const access = await getAccess()

	// AUTH-1: a client completes the profile (name, birth date, mobile,
	// nationality, gender) before reaching the portal. Staff and the seeded
	// administrators do not hold the Client role, so they are not stopped here.
	const isClient = (access.roles as readonly string[]).includes("Client")

	// PRC-2b: a client with no Privacy Notice consent on record, or one older
	// than the current notice, accepts it first (walk-in clients accepted it at
	// the counter). Asked before the profile, which is more personal data.
	const privacyNotice = privacyNoticeRedirect({
		isClient,
		privacyNoticeVersion: qspsUser.privacyNoticeVersion,
	})
	if (privacyNotice) {
		redirect(privacyNotice)
	}

	if (isClient && !qspsUser.profileCompletedAt) {
		redirect("/complete-profile")
	}

	const user = {
		name: session.user.name ?? null,
		email: session.user.email,
		image: session.user.image ?? null,
	}

	return (
		<SidebarProvider>
			{/* Scope the persisted cache to this user before anything reads it. */}
			<CacheIdentity />
			<AppSidebar user={user} access={access} />
			<SidebarInset>
				<SiteHeader />
				<div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
					<main className="min-w-0">{children}</main>
				</div>
				<SiteFooter />
			</SidebarInset>
		</SidebarProvider>
	)
}
