import { PublicShell } from "@/core/components/public-shell"

/** Terms and policies (ADM-9): open to anyone, signed in or not. */
export default function TermsLayout({ children }: { children: React.ReactNode }) {
	return <PublicShell>{children}</PublicShell>
}
