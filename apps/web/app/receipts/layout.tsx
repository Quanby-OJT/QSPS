import { PublicShell } from "@/core/components/public-shell"

/** Public e-Receipt verification behind the receipt's QR code (PAY-2). */
export default function ReceiptsLayout({ children }: { children: React.ReactNode }) {
	return <PublicShell>{children}</PublicShell>
}
