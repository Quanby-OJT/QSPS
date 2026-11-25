import type { MetadataRoute } from "next"

import { env } from "@/env"

/**
 * robots.txt (AUTH-3). Crawlers may read the public pages only. The staff
 * sign-in page is deliberately not named here: a Disallow line would publish
 * its address. That page carries its own noindex instead.
 */
const PRIVATE_PATHS = [
	"/dashboard",
	"/account",
	"/book",
	"/documents",
	"/payments",
	"/processing",
	"/user-management",
	"/locations",
	"/services",
	"/forms",
	"/cashier",
	"/payment-exceptions",
	"/schedules",
	"/audit-log",
	"/settings",
	"/security",
	"/complete-profile",
	"/privacy-notice",
	"/two-factor",
	"/reset-password",
	"/verify-email",
	"/session",
] as const

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] }],
		sitemap: `${env.NEXT_PUBLIC_APP_URL}/sitemap.xml`,
	}
}
