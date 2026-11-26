import { AnalyticsIdentityStamp } from "@/services/analytics/analytics-identity-stamp"
import { PublicLoginForm as LoginForm } from "@/features/announcements/components/public-login-form"

export default function LoginPage() {
	return (
		<section className="flex flex-1 flex-col items-center justify-center">
			{/* Signed out: clears a previous user's PostHog identity. */}
			<AnalyticsIdentityStamp userId={null} />
			<LoginForm className="w-full" />
		</section>
	)
}
