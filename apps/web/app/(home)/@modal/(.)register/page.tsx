import { AuthModal } from "@/features/auth/components/auth-modal"
import { RegisterForm } from "@/features/auth/register/components/register-form"

/**
 * /register opened from the home page: the form slides up over it (UI-1).
 * Opening /register directly still shows the full page.
 */
export default function RegisterModal() {
	return (
		<AuthModal route="/register" title="Create an account">
			<RegisterForm />
		</AuthModal>
	)
}
