import type { Metadata } from "next"

import { SmsSettings } from "@/features/auth/two-factor/components/sms-settings"

export const metadata: Metadata = { title: "Account" }

export default function AccountPage() {
	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-bold">Account</h1>
			<SmsSettings />
		</div>
	)
}
