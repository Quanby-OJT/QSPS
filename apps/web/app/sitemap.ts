import type { MetadataRoute } from "next"

import { env } from "@/env"

/**
 * The public pages (AUTH-3). The staff sign-in page is never listed: it is
 * reached only by those told its address.
 */
const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password", "/verify"] as const

export default function sitemap(): MetadataRoute.Sitemap {
	return PUBLIC_PATHS.map(path => ({
		url: `${env.NEXT_PUBLIC_APP_URL}${path === "/" ? "" : path}`,
		changeFrequency: "monthly",
		priority: path === "/" ? 1 : 0.5,
	}))
}