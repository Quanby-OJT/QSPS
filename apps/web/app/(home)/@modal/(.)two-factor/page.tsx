import { AnalyticsIdentityStamp } from "@/services/analytics/analytics-identity-stamp"
import { AuthModal } from "@/features/auth/components/auth-modal"
import { TwoFactorChallengeForm } from "@/features/auth/two-factor/components/two-factor-challenge-form"

/**
 * /two-factor reached from the sign in modal on the home page: the code step
 * opens in the same modal (AUTH-2). Opening /two-factor directly, or from the
 * full /login page, still shows the full page.
 */
export default function TwoFactorModal() {
	return (
		<AuthModal route="/two-factor" title="Confirm it's you">
			{/* Not signed in yet: no PostHog identity until the code is accepted. */}
			<AnalyticsIdentityStamp userId={null} />
			<TwoFactorChallengeForm />
		</AuthModal>
	)
}
