"use client"

import { useState } from "react"

import { Button } from "@/core/components/ui/button"
import { Skeleton } from "@/core/components/ui/skeleton"
import { useHydrated } from "@/core/hooks/use-hydrated"
import {
	announcementMediaUrl,
	useActiveAnnouncementQuery,
} from "@/features/announcements/api/announcements.hooks"
import { AnnouncementMedia } from "@/features/announcements/components/announcement-media"

/**
 * AUTH-4 (TOR VIII.2): the Gender and Development flash screen. When an
 * Announcement is showing, it comes first, with a button to continue to the
 * sign-in form. With none, or when it cannot be loaded, the form shows at once.
 */
export function AnnouncementGate({ children }: { children: React.ReactNode }) {
	const hydrated = useHydrated()
	const query = useActiveAnnouncementQuery()
	const [dismissedId, setDismissedId] = useState<number | null>(null)

	if (!hydrated || query.isPending) {
		return (
			<div className="w-full" role="status" aria-label="Loading">
				<Skeleton className="h-72 w-full rounded-xl" />
			</div>
		)
	}

	const announcement = query.data
	if (query.isError || !announcement || dismissedId === announcement.id) return <>{children}</>

	return (
		<section
			aria-labelledby="gad-announcement-title"
			className="bg-card w-full rounded-xl border p-4 shadow-sm sm:p-6"
		>
			<div className="bg-gold mb-2 h-1 w-10 rounded-full" />
			<p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
				Gender and Development
			</p>
			<h1 id="gad-announcement-title" className="mt-1 text-xl font-extrabold tracking-tight">
				{announcement.title}
			</h1>
			<div className="bg-muted mt-4 overflow-hidden rounded-lg">
				<AnnouncementMedia
					src={announcementMediaUrl(announcement.mediaPath)}
					mediaType={announcement.mediaType}
					title={announcement.title}
					autoPlay
				/>
			</div>
			<Button
				type="button"
				className="mt-4 h-11 w-full text-base"
				onClick={() => setDismissedId(announcement.id)}
			>
				Continue to sign in
			</Button>
		</section>
	)
}
