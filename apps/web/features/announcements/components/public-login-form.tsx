"use client"

import { AnnouncementGate } from "@/features/announcements/components/announcement-gate"
import { LoginForm } from "@/features/auth/login/components/login-form"

/** The client sign-in form, after the Gender and Development flash screen (AUTH-4). */
export function PublicLoginForm(props: React.ComponentProps<typeof LoginForm>) {
	return (
		<AnnouncementGate>
			<LoginForm {...props} />
		</AnnouncementGate>
	)
}
