import type { Metadata } from "next"

import { SmsSettings } from "@/features/auth/two-factor/components/sms-settings"

export const metadata: Metadata = { title: "Account" }

/** Account settings: mobile number and text messages (NTF-2). */
export default function AccountPage() {
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1.5">
				<span aria-hidden="true" className="bg-gold h-[3px] w-10" />
				<h1 className="text-2xl font-extrabold tracking-tight">Account</h1>
				<p className="text-muted-foreground">Your mobile number and text message settings.</p>
			</div>
			<SmsSettings />
		</div>
	)
}
