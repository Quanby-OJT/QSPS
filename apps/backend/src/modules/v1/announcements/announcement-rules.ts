import {
	ANNOUNCEMENT_MEDIA_TYPES,
	type AnnouncementContentType,
	type AnnouncementState,
} from "@repo/contracts"
import type { announcements } from "@repo/db/schema"

import { sniffContentType } from "@/common/storage/content-type"

/** One stored Announcement. */
export type AnnouncementRow = typeof announcements.$inferSelect

/** Where an Announcement stands at `now`. */
export function announcementState(
	row: Pick<AnnouncementRow, "isActive" | "startsAt" | "endsAt">,
	now: Date
): AnnouncementState {
	if (!row.isActive) return "inactive"
	if (row.startsAt > now) return "scheduled"
	if (row.endsAt && row.endsAt <= now) return "ended"
	return "showing"
}

/**
 * The accepted type a file really is, from its first bytes, or null.
 * JPG and PNG use the FRM-2 signatures; an MP4 has "ftyp" at bytes 4 to 7.
 */
export function sniffAnnouncementMedia(bytes: Uint8Array): AnnouncementContentType | null {
	const type = sniffContentType(bytes)
	if (type === "image/png" || type === "image/jpeg") return type
	if (
		bytes.length >= 12 &&
		bytes[4] === 0x66 &&
		bytes[5] === 0x74 &&
		bytes[6] === 0x79 &&
		bytes[7] === 0x70
	) {
		return "video/mp4"
	}
	return null
}

/** The content type of a stored key, from its extension. */
export function contentTypeOfKey(key: string): AnnouncementContentType {
	const extension = key.slice(key.lastIndexOf(".") + 1)
	const found = (Object.keys(ANNOUNCEMENT_MEDIA_TYPES) as AnnouncementContentType[]).find(
		type => ANNOUNCEMENT_MEDIA_TYPES[type].extension === extension
	)
	if (!found) throw new Error(`Unknown announcement media key "${key}"`)
	return found
}

/** Public file path, relative to /api/v1. `v` changes on every edit, so caches refresh. */
export function mediaPathOf(row: Pick<AnnouncementRow, "id" | "updatedAt">): string {
	return `/announcements/${row.id}/media?v=${row.updatedAt.getTime()}`
}

export function previewPathOf(row: Pick<AnnouncementRow, "id" | "updatedAt">): string {
	return `/announcements/${row.id}/media/preview?v=${row.updatedAt.getTime()}`
}

export type ByteRange = { start: number; end: number }

/**
 * One `Range: bytes=...` request against a file of `size` bytes. Null means
 * send the whole file (no header, or a form we do not serve, such as several
 * ranges); "invalid" means answer 416.
 */
export function parseByteRange(
	header: string | undefined,
	size: number
): ByteRange | null | "invalid" {
	if (!header) return null
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
	if (!match) return null
	const from = match[1] ?? ""
	const to = match[2] ?? ""
	if (from === "" && to === "") return null

	let start: number
	let end: number
	if (from === "") {
		const suffix = Number(to)
		if (suffix === 0) return "invalid"
		start = Math.max(size - suffix, 0)
		end = size - 1
	} else {
		start = Number(from)
		end = to === "" ? size - 1 : Math.min(Number(to), size - 1)
	}
	if (size === 0 || start > end || start >= size) return "invalid"
	return { start, end }
}
