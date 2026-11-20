import { cn } from "@/core/lib/utils"

/**
 * Button looks for plain links in server components (UI-1). `buttonVariants`
 * lives in a "use client" file, so server pages cannot call it; these are
 * the same shapes as plain class strings.
 */
const BASE =
	"inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"

const VARIANTS = {
	primary: "bg-primary text-primary-foreground hover:bg-primary/90",
	gold: "bg-gold text-gold-foreground hover:bg-gold/90 font-bold",
	/** White outline, for links on the navy hero and bands. */
	onDark: "border border-white/30 bg-transparent text-white hover:bg-white/10",
} as const

const SIZES = {
	md: "h-11 px-5 text-sm",
	lg: "h-13 px-6 text-base",
} as const

export function linkButton({
	variant = "primary",
	size = "md",
	className,
}: {
	variant?: keyof typeof VARIANTS
	size?: keyof typeof SIZES
	className?: string
} = {}): string {
	return cn(BASE, VARIANTS[variant], SIZES[size], className)
}
