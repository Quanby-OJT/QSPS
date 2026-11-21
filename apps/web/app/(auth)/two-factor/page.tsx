import { AnalyticsIdentityStamp } from "@/services/analytics/analytics-identity-stamp"
import { TwoFactorChallengeForm } from "@/features/auth/two-factor/components/two-factor-challenge-form"

/** Second sign-in step (AUTH-2). The password step sends people here. */
export default function TwoFactorPage() {
	return (
		<section className="flex flex-1 flex-col items-center justify-center">
			{/* Not signed in yet: no PostHog identity until the code is accepted. */}
			<AnalyticsIdentityStamp userId={null} />
			<TwoFactorChallengeForm className="w-full" />
		</section>
	)
}
