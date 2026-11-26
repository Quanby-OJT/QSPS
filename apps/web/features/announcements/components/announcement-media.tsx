import type { AnnouncementMediaKind } from "@repo/contracts"

import { cn } from "@/core/lib/utils"

interface AnnouncementMediaProps {
	src: string
	mediaType: AnnouncementMediaKind
	title: string
	className?: string
	autoPlay?: boolean
}

/** An Announcement's image or video, served by the API. */
export function AnnouncementMedia({
	src,
	mediaType,
	title,
	className,
	autoPlay = false,
}: AnnouncementMediaProps) {
	if (mediaType === "video") {
		return (
			<video
				src={src}
				controls
				playsInline
				muted={autoPlay}
				autoPlay={autoPlay}
				aria-label={title}
				className={cn("max-h-[60vh] w-full bg-black", className)}
			/>
		)
	}
	return (
		// eslint-disable-next-line @next/next/no-img-element -- served by the API; next/image cannot optimise it
		<img src={src} alt={title} className={cn("max-h-[60vh] w-full object-contain", className)} />
	)
}
