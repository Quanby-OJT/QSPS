import { AnalyticsIdentityStamp } from "@/services/analytics/analytics-identity-stamp"
import { PublicLoginForm as LoginForm } from "@/features/announcements/components/public-login-form"
import { AuthModal } from "@/features/auth/components/auth-modal"

/**
 * /login opened from the home page: the sign-in form slides up over it
 * (UI-1). Opening /login directly still shows the full sign-in page.
 */
export default function LoginModal() {
	return (
		<AuthModal route="/login" title="Sign in">
			{/* Signed out: clears a previous user's PostHog identity. */}
			<AnalyticsIdentityStamp userId={null} />
			<LoginForm />
		</AuthModal>
	)
}
