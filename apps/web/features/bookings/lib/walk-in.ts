import type { WalkInSlot } from "@repo/contracts"

/** Same as MIN_WALK_IN_LOOKUP_LENGTH in @repo/contracts. */
const MIN_LOOKUP_LENGTH = 5
const MIN_MOBILE_DIGITS = 10

/**
 * What the officer typed in the client search: an email address, a mobile
 * number, or neither (so nothing is sent). The API matches exactly, so a
 * partial number would only ever find nothing.
 */
export function walkInLookupKind(text: string): "email" | "mobile" | null {
	const value = text.trim()
	if (value.length < MIN_LOOKUP_LENGTH) return null
	if (value.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? "email" : null
	if (/[^\d\s()+-]/.test(value)) return null
	return value.replace(/\D/g, "").length >= MIN_MOBILE_DIGITS ? "mobile" : null
}

/** Whether a slot can still take the walk-in. */
export function canChooseWalkInSlot(slot: Pick<WalkInSlot, "remaining">): boolean {
	return slot.remaining > 0
}

/** "3 places left", "1 place left" or "Full". */
export function placesLeftLabel(slot: Pick<WalkInSlot, "remaining">): string {
	if (slot.remaining <= 0) return "Full"
	return `${slot.remaining} ${slot.remaining === 1 ? "place" : "places"} left`
}

/** The new-client form as typed, before the API's checks. */
export interface WalkInClientDraft {
	name: string
	email: string
	mobile: string
	birthDate: string
	nationality: string
	gender: string
}

export const EMPTY_WALK_IN_CLIENT: WalkInClientDraft = {
	name: "",
	email: "",
	mobile: "",
	birthDate: "",
	nationality: "",
	gender: "",
}

/** The new-client form, started from what the officer searched for. */
export function draftFromLookup(text: string): WalkInClientDraft {
	const kind = walkInLookupKind(text)
	const value = text.trim()
	return {
		...EMPTY_WALK_IN_CLIENT,
		email: kind === "email" ? value.toLowerCase() : "",
		mobile: kind === "mobile" ? value : "",
	}
}
