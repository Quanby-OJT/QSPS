import { PublicShell } from "@/core/components/public-shell"

/** Public document verification, by QR code or by number and code (CRT-2). */
export default function VerifyLayout({ children }: { children: React.ReactNode }) {
	return <PublicShell>{children}</PublicShell>
}
