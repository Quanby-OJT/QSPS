import { PublicShell } from "@/core/components/public-shell"

/** Help (ADM-8): open to anyone, signed in or not. */
export default function HelpLayout({ children }: { children: React.ReactNode }) {
	return <PublicShell>{children}</PublicShell>
}
