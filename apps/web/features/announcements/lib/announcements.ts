import {
	BUSINESS_TIMEZONE,
	CreateAnnouncementSchema,
	type Announcement,
	type AnnouncementMediaKind,
	type AnnouncementState,
	type CreateAnnouncementInput,
} from "@repo/contracts"

const inputParts = new Intl.DateTimeFormat("en-CA", {
	timeZone: BUSINESS_TIMEZONE,
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
})

/** "2026-11-26T15:30": the instant in Manila time, for <input type="datetime-local">. */
export function toManilaInput(date: Date): string {
	const parts = Object.fromEntries(
		inputParts.formatToParts(date).map(part => [part.type, part.value])
	)
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** A datetime-local value read as Manila time (UTC+8, no daylight saving); null when not filled in. */
export function fromManilaInput(value: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
	return `${value}:00+08:00`
}

const dateTime = new Intl.DateTimeFormat("en-PH", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: BUSINESS_TIMEZONE,
})

export function formatAnnouncementDate(date: Date | string): string {
	return dateTime.format(new Date(date))
}

const STATE_LABELS: Record<AnnouncementState, string> = {
	showing: "Showing now",
	scheduled: "Scheduled",
	ended: "Ended",
	inactive: "Inactive",
}

export function stateLabel(state: AnnouncementState): string {
	return STATE_LABELS[state]
}

/** What the admin is editing. Dates are datetime-local values in Manila time. */
export interface AnnouncementDraft {
	title: string
	mediaKey: string | null
	mediaType: AnnouncementMediaKind | null
	startsAt: string
	endsAt: string
}

export function emptyDraft(now: Date = new Date()): AnnouncementDraft {
	return { title: "", mediaKey: null, mediaType: null, startsAt: toManilaInput(now), endsAt: "" }
}

export function draftFrom(announcement: Announcement): AnnouncementDraft {
	return {
		title: announcement.title,
		mediaKey: announcement.mediaKey,
		mediaType: announcement.mediaType,
		startsAt: toManilaInput(new Date(announcement.startsAt)),
		endsAt: announcement.endsAt ? toManilaInput(new Date(announcement.endsAt)) : "",
	}
}

export type ParsedAnnouncementDraft =
	| { ok: true; value: CreateAnnouncementInput }
	| { ok: false; message: string }

/** The draft checked with the same rules the API applies. */
export function parseAnnouncementDraft(draft: AnnouncementDraft): ParsedAnnouncementDraft {
	if (!draft.mediaKey) return { ok: false, message: "Upload an image or video" }
	const startsAt = fromManilaInput(draft.startsAt)
	if (!startsAt) return { ok: false, message: "Enter when it starts" }
	const endsAt = draft.endsAt.trim() === "" ? null : fromManilaInput(draft.endsAt)
	if (draft.endsAt.trim() !== "" && !endsAt) return { ok: false, message: "Enter a valid end" }
	const parsed = CreateAnnouncementSchema.safeParse({
		title: draft.title,
		mediaKey: draft.mediaKey,
		startsAt,
		endsAt,
	})
	if (!parsed.success) {
		return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the announcement" }
	}
	return { ok: true, value: parsed.data }
}
