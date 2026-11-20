import { AuthModal } from "@/features/auth/components/auth-modal"
import { ForgotPasswordForm } from "@/features/auth/forgot-password/components/forgot-password-form"

/**
 * /forgot-password opened from the sign-in panel: the form replaces it in
 * the same panel (UI-1). Opening /forgot-password directly still shows the
 * full page.
 */
export default function ForgotPasswordModal() {
	return (
		<AuthModal route="/forgot-password" title="Forgot password">
			<ForgotPasswordForm />
		</AuthModal>
	)
}
