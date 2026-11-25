import {
	CreateWalkInClientSchema,
	PRIVACY_NOTICE_VERSION,
	type CreateWalkInClientInput,
	type WalkInSlot,
} from "@repo/contracts"

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
	/** "Client accepted the Privacy Notice", ticked at the counter (PRC-2b). */
	privacyAccepted: boolean
}

export const EMPTY_WALK_IN_CLIENT: WalkInClientDraft = {
	name: "",
	email: "",
	mobile: "",
	birthDate: "",
	nationality: "",
	gender: "",
	privacyAccepted: false,
}

/** What screens show for a client's email: a mobile-only client has none (PRC-2b). */
export function clientEmailLabel(email: string | null): string {
	return email ?? "No email"
}

export type WalkInDraftErrors = Partial<Record<keyof WalkInClientDraft, string>>

/**
 * Check the new-client form. Without the Privacy Notice tick the account
 * cannot be created; the API refuses it too. Errors are keyed by form field.
 */
export function checkWalkInClientDraft(
	draft: WalkInClientDraft
): { ok: true; input: CreateWalkInClientInput } | { ok: false; errors: WalkInDraftErrors } {
	const { privacyAccepted, ...fields } = draft
	const parsed = CreateWalkInClientSchema.safeParse({
		...fields,
		...(privacyAccepted ? { privacyNoticeVersion: PRIVACY_NOTICE_VERSION } : {}),
	})
	if (parsed.success) return { ok: true, input: parsed.data }
	const errors: WalkInDraftErrors = {}
	for (const issue of parsed.error.issues) {
		const key = issue.path[0]
		const field = (key === "privacyNoticeVersion" ? "privacyAccepted" : key) as
			| keyof WalkInClientDraft
			| undefined
		if (field && !errors[field]) {
			errors[field] =
				field === "privacyAccepted"
					? "Tick this only after the client has read and accepted the Privacy Notice"
					: issue.message
		}
	}
	return { ok: false, errors }
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
